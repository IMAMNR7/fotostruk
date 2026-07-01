import { useEffect, useRef } from 'react';
import QRious from 'qrious';

// ======================== IMAGE PROCESSING FILTERS ========================

// Convert to grayscale only (no 1-bit conversion)
function applyGrayscale(imageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    data[i] = gray;
    data[i+1] = gray;
    data[i+2] = gray;
  }
}

// Simple black/white threshold
function applyThreshold(imageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    const val = gray > 128 ? 255 : 0;
    data[i] = val;
    data[i+1] = val;
    data[i+2] = val;
  }
}

// Bayer 8x8 ordered dithering — the gold standard for thermal printers
// Produces uniform halftone pattern without directional artifacts (no horizontal lines)
// Each pixel's threshold is independent, based only on its (x,y) position in the pattern
function applyBayerDither(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // Normalized 8x8 Bayer threshold matrix (values 0..63 mapped to 0..255)
  const bayer8x8 = [
    [  0, 32,  8, 40,  2, 34, 10, 42],
    [ 48, 16, 56, 24, 50, 18, 58, 26],
    [ 12, 44,  4, 36, 14, 46,  6, 38],
    [ 60, 28, 52, 20, 62, 30, 54, 22],
    [  3, 35, 11, 43,  1, 33,  9, 41],
    [ 51, 19, 59, 27, 49, 17, 57, 25],
    [ 15, 47,  7, 39, 13, 45,  5, 37],
    [ 63, 31, 55, 23, 61, 29, 53, 21]
  ];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      
      // Centered threshold: map Bayer 0-63 to range 64-192 (centered around 128)
      // This creates a finer, more natural "semut" grain pattern
      // vs full 0-255 range which is too harsh and creates blocky areas
      const bayerVal = bayer8x8[y & 7][x & 7]; // 0..63
      const threshold = 64 + (bayerVal / 63) * 128; // maps to 64..192
      
      const val = gray > threshold ? 255 : 0;
      data[idx]     = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
    }
  }
}

// Gamma correction — lighten image for thermal printer (prints darker than screen)
function applyGammaCorrection(imageData, gamma) {
  const data = imageData.data;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(i / 255, 1 / gamma))));
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

// Contrast enhancement curve — S-curve for better tonal separation
function applyContrastCurve(imageData, strength) {
  const data = imageData.data;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    // S-curve using sigmoid function
    const x = i / 255;
    const s = 1 / (1 + Math.exp(-strength * (x - 0.5)));
    lut[i] = Math.min(255, Math.max(0, Math.round(s * 255)));
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

// Helper to calculate target height of collage
function calculateTargetHeight(layoutMode, N, photosList) {
  if (layoutMode === 'strip') {
    const gap = 16;
    const border = 4;
    const innerWidth = 384 - (border * 2);
    const cellW = innerWidth;
    const cellH = Math.floor(cellW * 0.75);
    return (border * 2) + N * cellH + (N - 1) * gap;
  } else {
    if (N === 0) return 0;
    const gap = 16;
    let cols = 1;
    let rows = 1;
    
    if (N === 2) {
      cols = 2; rows = 1;
    } else if (N === 3) {
      cols = 3; rows = 1;
    } else if (N === 4) {
      cols = 2; rows = 2;
    } else if (N >= 5) {
      cols = 3; rows = 2;
    }
    
    if (N === 1) {
      const img = photosList[0].imgElement;
      const aspect = img.height / img.width;
      return Math.round(384 * aspect);
    } else {
      const cellWidth = Math.floor((384 - (cols - 1) * gap) / cols);
      const cellHeight = cellWidth;
      return rows * cellHeight + (rows - 1) * gap;
    }
  }
}

export default function ReceiptPreview({
  photosList,
  brightness,
  contrast,
  filterMode,
  layoutMode,
  printSections,
  spacingMode,
  driveUrl,
  captionText,
  canvasRef, // Forward canvas reference to main App for printing
  logoImgRef // Forward logo image reference for BLE print rendering
}) {
  const logoCanvasRef = useRef(null);
  const qrCanvasRef = useRef(null);
  const placeholderRef = useRef(null);

  // 1. Draw B&W Logo Canvas
  useEffect(() => {
    const logoCanvas = logoCanvasRef.current;
    if (!logoCanvas) return;
    const ctx = logoCanvas.getContext('2d');
    
    const img = new Image();
    img.onload = () => {
      if (logoImgRef) logoImgRef.current = img;
      const size = 1024; // full high-definition resolution for ultra-sharp canvas rendering
      logoCanvas.width = size;
      logoCanvas.height = size;
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      
      try {
        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          const a = data[i+3];
          
          if (a < 10) {
            data[i] = 255;
            data[i+1] = 255;
            data[i+2] = 255;
            data[i+3] = 255;
          } else {
            // Target yellow/gold tones and blue/navy tones specifically
            const isYellowGold = (r > 120 && g > 100 && b < 90);
            const isBlue = (b > r + 20 && b > g + 20);
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            
            let val;
            if (isBlue) {
              const pixelIdx = i / 4;
              const px = pixelIdx % 1024;
              const py = Math.floor(pixelIdx / 1024);
              const dx = px - 512;
              const dy = py - 512;
              const dist = Math.sqrt(dx*dx + dy*dy);
              val = dist < 380 ? 255 : 0; // White inside center, Black for ribbon at bottom
            } else {
              val = (isYellowGold || gray > 175) ? 255 : 0;
            }
            
            data[i] = val;
            data[i+1] = val;
            data[i+2] = val;
            data[i+3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      } catch (corsErr) {
        console.warn("CORS issue converting logo to B&W:", corsErr);
      }
    };
    img.src = 'logo_himsi.png';
  }, [printSections.header, logoImgRef]);

  // 2. Render QR Code Canvas
  useEffect(() => {
    const qrCanvas = qrCanvasRef.current;
    if (!qrCanvas) return;
    const ctx = qrCanvas.getContext('2d');
    
    if (!printSections.qr) return;

    const displaySize = 256;
    if (driveUrl.trim() === '') {
      // Draw placeholder
      qrCanvas.width = displaySize;
      qrCanvas.height = displaySize;
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, displaySize, displaySize);
      ctx.fillStyle = '#999';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('QR Code', displaySize / 2, displaySize / 2 - 15);
      ctx.font = '18px sans-serif';
      ctx.fillText('Isi link dulu', displaySize / 2, displaySize / 2 + 15);
    } else {
      // Use the URL directly — it's already a full redirect.html?p=... URL
      // No need to wrap with getRedirectUrl which would double-encode and make the QR too dense
      const finalUrl = driveUrl.trim();
      qrCanvas.width = displaySize;
      qrCanvas.height = displaySize;
      new QRious({
        element: qrCanvas,
        value: finalUrl,
        size: displaySize,
        background: 'white',
        foreground: 'black',
        level: 'H'
      });
    }
  }, [driveUrl, printSections.qr]);

  // 3. Render Photo Collage Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    if (photosList.length === 0) {
      canvas.style.display = 'none';
      if (placeholderRef.current) placeholderRef.current.style.display = 'flex';
      return;
    }
    
    canvas.style.display = 'block';
    if (placeholderRef.current) placeholderRef.current.style.display = 'none';

    const N = photosList.length;
    const targetWidth = 384;
    const targetHeight = calculateTargetHeight(layoutMode, N, photosList);
    
    // Create an offscreen canvas to process the combined layout
    const offscreen = document.createElement('canvas');
    offscreen.width = targetWidth;
    offscreen.height = targetHeight;

    if (layoutMode === 'strip') {
      const gap = 16;
      const border = 4;
      const innerWidth = targetWidth - (border * 2);
      const cellW = innerWidth;
      const cellH = Math.floor(cellW * 0.75); // 4:3 aspect ratio per photo
      
      const offCtx = offscreen.getContext('2d');
      
      // White background for strip borders
      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, targetWidth, targetHeight);
      
      // Draw photos vertically
      photosList.forEach((photo, idx) => {
        const x = border;
        const y = border + idx * (cellH + gap);
        const img = photo.imgElement;
        
        const imgAspect = img.width / img.height;
        const cellAspect = cellW / cellH;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (imgAspect > cellAspect) {
          sw = img.height * cellAspect;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / cellAspect;
          sy = (img.height - sh) / 2;
        }
        
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(x, y, cellW, cellH);
        offCtx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
      });
    } else {
      // Grid Collage Layout
      const gap = 16;
      let cols = 1;
      let cellWidth = 384;
      let cellHeight = 384;
      
      if (N === 2) {
        cols = 2;
      } else if (N === 3) {
        cols = 3;
      } else if (N === 4) {
        cols = 2;
      } else if (N >= 5) {
        cols = 3;
      }
      
      if (N === 1) {
        const img = photosList[0].imgElement;
        const aspect = img.height / img.width;
        cellWidth = 384;
        cellHeight = Math.round(384 * aspect);
      } else {
        cellWidth = Math.floor((384 - (cols - 1) * gap) / cols);
        cellHeight = cellWidth;
      }
      
      const offCtx = offscreen.getContext('2d');
      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, targetWidth, targetHeight);
      
      photosList.forEach((photo, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = col * (cellWidth + gap);
        const y = row * (cellHeight + gap);
        const img = photo.imgElement;
        
        const imgAspect = img.width / img.height;
        const cellAspect = cellWidth / cellHeight;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (imgAspect > cellAspect) {
          sw = img.height * cellAspect;
          sx = (img.width - sw) / 2;
        } else {
          sh = img.width / cellAspect;
          sy = (img.height - sh) / 2;
        }
        
        offCtx.drawImage(img, sx, sy, sw, sh, x, y, cellWidth, cellHeight);
      });
    }
    
    // Set actual canvas size
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw processed image with brightness & contrast adjustments
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(offscreen, 0, 0);
    
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    
    // Step 1: Apply brightness adjustment (default=0, range roughly -100..+100)
    // Fix: defaults are 0-centered, NOT 100-centered
    const bAdj = brightness * 2.0;  // map -100..+100 to -200..+200
    const cAdj = contrast * 2.0;
    if (bAdj !== 0 || cAdj !== 0) {
      const cFactor = cAdj >= 0
        ? (259 * (cAdj + 255)) / (255 * (259 - cAdj))
        : (259 * (cAdj + 255)) / (255 * (259 - cAdj));
      const imgPixels = imgData.data;
      for (let i = 0; i < imgPixels.length; i += 4) {
        for (let ch = 0; ch < 3; ch++) {
          let val = imgPixels[i + ch];
          val = cFactor * (val - 128) + 128 + bAdj;
          imgPixels[i + ch] = Math.max(0, Math.min(255, val));
        }
      }
    }
    
    // Step 2: Gamma correction — lighten for thermal printer (prints darker than screen)
    applyGammaCorrection(imgData, 1.3);
    
    // Step 3: Mild contrast boost for tonal separation (not too strong = avoid black)
    applyContrastCurve(imgData, 5);
    
    // Step 4: Apply image filter
    // Bayer ordered dithering = uniform pattern, NO horizontal line artifacts
    if (filterMode === 'dither') {
      applyBayerDither(imgData);
    } else if (filterMode === 'threshold') {
      applyThreshold(imgData);
    } else {
      applyGrayscale(imgData);
    }
    
    ctx.putImageData(imgData, 0, 0);

    // Draw borders and separators after dithering
    if (N > 1) {
      if (layoutMode === 'strip') {
        const gap = 16;
        const border = 4;
        const innerWidth = targetWidth - (border * 2);
        const cellW = innerWidth;
        const cellH = Math.floor(cellW * 0.75);
        
        // Clean white gaps between photos
        ctx.fillStyle = '#ffffff';
        for (let idx = 0; idx < N - 1; idx++) {
          const gapY = border + cellH + idx * (cellH + gap);
          ctx.fillRect(0, gapY, targetWidth, gap);
        }
        
        // Dark black borders on LEFT and RIGHT — per photo (breaks at gaps)
        ctx.fillStyle = '#000000';
        for (let idx = 0; idx < N; idx++) {
          const photoY = border + idx * (cellH + gap);
          ctx.fillRect(0, photoY, border, cellH);                          // left
          ctx.fillRect(targetWidth - border, photoY, border, cellH);       // right
        }
      } else {
        const gap = 16;
        let cols = 1;
        
        if (N === 2) {
          cols = 2;
        } else if (N === 3) {
          cols = 3;
        } else if (N === 4) {
          cols = 2;
        } else if (N >= 5) {
          cols = 3;
        }
        
        const cellWidth = Math.floor((384 - (cols - 1) * gap) / cols);
        const cellHeight = cellWidth;
        const rows = Math.ceil(N / cols);
        
        // Clean white vertical gaps
        ctx.fillStyle = '#ffffff';
        for (let col = 0; col < cols - 1; col++) {
          const gapX = cellWidth + col * (cellWidth + gap);
          ctx.fillRect(gapX, 0, gap, targetHeight);
        }
        
        // Clean white horizontal gaps
        for (let row = 0; row < rows - 1; row++) {
          const gapY = cellHeight + row * (cellHeight + gap);
          ctx.fillRect(0, gapY, targetWidth, gap);
        }
      }
    } else if (N === 1) {
      // Single photo: dark borders left/right
      const border = 4;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, border, targetHeight);
      ctx.fillRect(targetWidth - border, 0, border, targetHeight);
    }
  }, [photosList, brightness, contrast, filterMode, layoutMode, canvasRef]);

  const isCompact = spacingMode === 'compact';

  return (
    <div className="receipt-container" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className="printer-mockup">
        <div className="printer-top"></div>
        <div className="printer-slot"></div>
        
        <div 
          className={`receipt-paper ${isCompact ? 'compact-spacing' : ''}`} 
          id="receipt-paper"
        >
          {/* Header section (logo left, qr right) */}
          {printSections.header && (
            <>
              <div 
                className="receipt-header" 
                id="receipt-header-section"
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                  <canvas ref={logoCanvasRef} className="receipt-logo"></canvas>
                  <p className="font-bold" style={{ fontSize: '12px', marginTop: '6px', lineHeight: 1.35, textAlign: 'center', fontWeight: '800' }}>
                    Himpunan Mahasiswa<br />Sistem Informasi UIGM
                  </p>
                </div>
                
                {printSections.qr && (
                  <div id="receipt-qr-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                    <canvas ref={qrCanvasRef} id="receipt-qr-canvas"></canvas>
                    <span className="font-bold" style={{ fontSize: '12px', fontWeight: '800', textAlign: 'center', marginTop: '6px' }}>
                      Scan lihat semua foto
                    </span>
                  </div>
                )}
              </div>
              <div className="receipt-divider" id="receipt-header-divider"></div>
            </>
          )}

          {/* Date & Time */}
          {printSections.meta && (
            <>
              <div className="receipt-meta" id="receipt-meta-section">
                <span id="receipt-datetime">
                  {new Date().toLocaleString('id-ID', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZoneName: 'short'
                  })}
                </span>
              </div>
              <div className="receipt-divider" id="receipt-meta-divider"></div>
            </>
          )}

          {/* Struk Title */}
          {printSections.title && (
            <div className="receipt-title" id="receipt-title-section">
              <h4>FOTO STRUK KENANGAN</h4>
            </div>
          )}

          {/* Photo Canvas Container */}
          <div className="receipt-image-container">
            <canvas ref={canvasRef} className="receipt-canvas"></canvas>
            <div ref={placeholderRef} className="canvas-placeholder">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="placeholder-icon">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              <p>Upload min. 3 foto</p>
            </div>
          </div>

          {/* Caption / Description */}
          {printSections.caption && captionText.trim() !== '' && (
            <>
              <div className="receipt-divider" id="receipt-caption-divider"></div>
              <div className="receipt-caption" id="receipt-caption">
                {captionText}
              </div>
            </>
          )}

          {/* Footer Info */}
          {printSections.footer && (
            <>
              <div className="receipt-divider" id="receipt-footer-divider"></div>
              <div className="receipt-footer" id="receipt-footer-section">
                <p className="font-bold">Terima Kasih Sudah Mampir</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
