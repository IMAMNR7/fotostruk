import { useEffect, useRef } from 'react';
import QRious from 'qrious';
import { getRedirectUrl } from '../utils/printer';

// Image processing filters
function applyGrayscale(imageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    data[i] = gray;
    data[i+1] = gray;
    data[i+2] = gray;
  }
}

function applyThreshold(imageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    const val = gray > 127 ? 255 : 0;
    data[i] = val;
    data[i+1] = val;
    data[i+2] = val;
  }
}

function applyFloydSteinbergDither(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // Create floating point buffer for color values
  const grayData = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    grayData[i / 4] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
  }
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const oldPixel = grayData[idx];
      const newPixel = oldPixel > 127 ? 255 : 0;
      grayData[idx] = newPixel;
      
      const err = oldPixel - newPixel;
      
      // Distribute error to neighboring pixels
      if (x + 1 < width) grayData[idx + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x - 1 >= 0) grayData[idx + width - 1] += (err * 3) / 16;
        grayData[idx + width] += (err * 5) / 16;
        if (x + 1 < width) grayData[idx + width + 1] += (err * 1) / 16;
      }
    }
  }
  
  // Map back to canvas image bytes
  for (let i = 0; i < data.length; i += 4) {
    const val = Math.max(0, Math.min(255, grayData[i / 4]));
    data[i] = val;
    data[i+1] = val;
    data[i+2] = val;
  }
}

// Helper to calculate target height of collage
function calculateTargetHeight(layoutMode, N, photosList) {
  if (layoutMode === 'strip') {
    const gap = 4;
    const border = 4;
    const innerWidth = 384 - (border * 2);
    const cellW = innerWidth;
    const cellH = Math.floor(cellW * 0.75);
    return (border * 2) + N * cellH + (N - 1) * gap;
  } else {
    let rows = 1;
    if (N === 2 || N === 3) {
      rows = 1;
    } else if (N === 4 || N >= 5) {
      rows = 2;
    }
    
    if (N === 1) {
      const img = photosList[0].imgElement;
      const aspect = img.height / img.width;
      return Math.round(384 * aspect);
    } else {
      let cellHeight = 384;
      if (N === 2) {
        cellHeight = 192;
      } else if (N === 3) {
        cellHeight = 128;
      } else if (N === 4) {
        cellHeight = 192;
      } else if (N >= 5) {
        cellHeight = 128;
      }
      return rows * cellHeight;
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
      const finalUrl = getRedirectUrl(driveUrl.trim());
      qrCanvas.width = displaySize;
      qrCanvas.height = displaySize;
      new QRious({
        element: qrCanvas,
        value: finalUrl,
        size: displaySize,
        background: 'white',
        foreground: 'black',
        level: 'M'
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
      const gap = 4;
      const border = 4;
      const innerWidth = targetWidth - (border * 2);
      const cellW = innerWidth;
      const cellH = Math.floor(cellW * 0.75); // 4:3 aspect ratio per photo
      
      const offCtx = offscreen.getContext('2d');
      
      // Black background for strip borders
      offCtx.fillStyle = '#000000';
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
      let cols = 1;
      let cellWidth = 384;
      let cellHeight = 384;
      
      if (N === 2) {
        cols = 2;
        cellWidth = 192; cellHeight = 192;
      } else if (N === 3) {
        cols = 3;
        cellWidth = 128; cellHeight = 128;
      } else if (N === 4) {
        cols = 2;
        cellWidth = 192; cellHeight = 192;
      } else if (N >= 5) {
        cols = 3;
        cellWidth = 128; cellHeight = 128;
      }
      
      if (N === 1) {
        const img = photosList[0].imgElement;
        const aspect = img.height / img.width;
        cellHeight = Math.round(384 * aspect);
      }
      
      const offCtx = offscreen.getContext('2d');
      offCtx.fillStyle = '#ffffff';
      offCtx.fillRect(0, 0, targetWidth, targetHeight);
      
      photosList.forEach((photo, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = col * cellWidth;
        const y = row * cellHeight;
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
    
    // Apply image filter
    if (filterMode === 'dither') {
      applyFloydSteinbergDither(imgData);
    } else if (filterMode === 'threshold') {
      applyThreshold(imgData);
    } else {
      applyGrayscale(imgData);
    }
    
    ctx.putImageData(imgData, 0, 0);
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
