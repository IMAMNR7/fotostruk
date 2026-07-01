import QRious from 'qrious';

// Web Bluetooth BLE connection state variables
let bleDevice = null;
let bleCharacteristic = null;

// Helper to construct redirection URL through donation landing page
export function getRedirectUrl(targetUrl) {
  const baseUrl = window.location.href.split('?')[0].split('#')[0];
  const redirectBase = baseUrl.substring(0, baseUrl.lastIndexOf('/')) + '/redirect.html';
  return `${redirectBase}?url=${encodeURIComponent(targetUrl)}`;
}

// Convert canvas to array of raster band buffers (24 rows each for speed)
// Each band is a complete GS v 0 command
export function getPrinterImageBands(canvasElement) {
  const ctx = canvasElement.getContext('2d');
  const width = canvasElement.width;
  const height = canvasElement.height;
  const xBytes = Math.floor(width / 8);
  const BAND = 24; // 24 rows per band — good balance of speed vs buffer safety
  
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const bands = [];
  
  for (let bandY = 0; bandY < height; bandY += BAND) {
    const bandH = Math.min(BAND, height - bandY);
    
    const xL = xBytes % 256;
    const xH = Math.floor(xBytes / 256);
    const yL = bandH % 256;
    const yH = Math.floor(bandH / 256);
    const header = new Uint8Array([0x1D, 0x76, 0x30, 0, xL, xH, yL, yH]);
    
    const rowBytes = new Uint8Array(xBytes * bandH);
    let ri = 0;
    
    for (let y = bandY; y < bandY + bandH; y++) {
      for (let xByte = 0; xByte < xBytes; xByte++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          const pixelIdx = (y * width + x) * 4;
          if (pixelIdx < data.length) {
            const gray = 0.299 * data[pixelIdx] + 0.587 * data[pixelIdx+1] + 0.114 * data[pixelIdx+2];
            if (data[pixelIdx+3] >= 10 && gray < 128) {
              byteVal |= (1 << (7 - bit));
            }
          }
        }
        rowBytes[ri++] = byteVal;
      }
    }
    
    const band = new Uint8Array(header.length + rowBytes.length);
    band.set(header, 0);
    band.set(rowBytes, header.length);
    bands.push(band);
  }
  
  return bands;
}

// Connect to a Web Bluetooth BLE thermal printer
export async function connectBluetooth(onStatusChange) {
  try {
    onStatusChange('Menghubungkan...');
    
    bleDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb', // Common printer service 1
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Common printer service 2 (ISSC)
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Printer service 3
        '000018f1-0000-1000-8000-00805f9b34fb',
        '0000af30-0000-1000-8000-00805f9b34fb',
        '0000e781-0000-1000-8000-00805f9b34fb'
      ]
    });
    
    bleDevice.addEventListener('gattserverdisconnected', () => {
      bleCharacteristic = null;
      onStatusChange('Terputus');
    });
    
    const server = await bleDevice.gatt.connect();
    
    // Find writable characteristic in services
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const chars = await service.getCharacteristics();
      for (const char of chars) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          bleCharacteristic = char;
          onStatusChange('Terhubung');
          return true;
        }
      }
    }
    
    throw new Error('Tidak menemukan characteristic write pada printer BLE!');
  } catch (err) {
    console.error('BLE connection failed:', err);
    onStatusChange('Gagal Terhubung');
    bleDevice = null;
    bleCharacteristic = null;
    throw err;
  }
}

// Disconnect the BLE printer
export async function disconnectBluetooth(onStatusChange) {
  if (bleDevice && bleDevice.gatt.connected) {
    await bleDevice.gatt.disconnect();
  }
  bleDevice = null;
  bleCharacteristic = null;
  onStatusChange('Terputus');
}

// Optimized BLE data transmission with adaptive flow control
async function writeBytes(data) {
  if (!bleCharacteristic) return;
  
  const hasWithoutResponse = bleCharacteristic.properties.writeWithoutResponse;
  // 120 bytes is a safe chunk size for most BLE adapters (fits comfortably in typical MTU)
  const maxChunkSize = 120; 
  let offset = 0;
  
  while (offset < data.length) {
    const chunk = data.slice(offset, offset + maxChunkSize);
    try {
      if (hasWithoutResponse) {
        await bleCharacteristic.writeValueWithoutResponse(chunk);
        // 10ms delay is the sweet spot for 115200bps internal serial bridge (1.2KB/s per 10ms)
        // Shorter delay might overflow serial buffer; longer delay causes motor stuttering
        await new Promise(r => setTimeout(r, 10)); 
      } else {
        await bleCharacteristic.writeValue(chunk);
        // writeValue (with response) naturally awaits BLE link-layer ACK.
        // We only need a tiny 2ms delay to give the printer's MCU a brief moment to copy the buffer
        await new Promise(r => setTimeout(r, 2));
      }
    } catch (writeErr) {
      console.warn('BLE write retry:', writeErr.message);
      await new Promise(r => setTimeout(r, 100)); // longer pause on error
      if (hasWithoutResponse) {
        await bleCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await bleCharacteristic.writeValue(chunk);
      }
      await new Promise(r => setTimeout(r, 20));
    }
    offset += maxChunkSize;
  }
}

// Send image bands with minimal pauses to maintain motor momentum (prevent stuttering)
// while avoiding buffer overflow.
async function writeImageBands(bands) {
  for (let i = 0; i < bands.length; i++) {
    await writeBytes(bands[i]);
    
    // We only pause for 15ms. This is short enough that the printer's motor keeps spinning
    // continuously (avoiding stuttering lines), but gives the CPU a tiny moment to process.
    await new Promise(r => setTimeout(r, 15));
    
    // A moderate 40ms pause every 4 bands is enough to let the printer clear any backlog
    // without letting the motor completely stop.
    if ((i + 1) % 4 === 0) {
      await new Promise(r => setTimeout(r, 40));
    }
  }
}


// Compile layout elements and send to bluetooth thermal printer
export async function printViaBluetooth(photosCanvas, logoImg, driveUrl, printSections, spacingMode, captionText) {
  if (!bleCharacteristic) {
    alert("Printer Bluetooth belum terhubung!");
    return;
  }
  
  try {
    const chunks = [];
    const encoder = new TextEncoder();
    const isCompact = spacingMode === 'compact';
    const dividerText = isCompact ? "----------------\n" : "--------------------------------\n";
    
    // Initialize ESC/POS command
    chunks.push(new Uint8Array([0x1B, 0x40]));
    
    // Center alignment command
    chunks.push(new Uint8Array([0x1B, 0x61, 0x01]));
    
    // 1. Combined Header (Logo & Text on Left, QR on Right)
    const showHeader = printSections.header;
    const showQr = printSections.qr && driveUrl.trim() !== "";
    
    if (showHeader || showQr) {
      const headerCanvas = document.createElement('canvas');
      headerCanvas.width = 384;
      headerCanvas.height = 216; // Must match the area we process with getImageData
      const ctx = headerCanvas.getContext('2d');
      
      // White canvas background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 384, 216);
      
      const hasLogo = showHeader && logoImg && logoImg.complete && logoImg.naturalWidth > 0;
      
      if (hasLogo && showQr) {
        // Logo on Left (size 170x170)
        ctx.drawImage(logoImg, 5, 10, 170, 170);
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        
        // Helper to draw bold/thick text by overlaying slightly offset fills
        const drawThickText = (text, x, y) => {
          ctx.fillText(text, x, y);
          ctx.fillText(text, x + 0.5, y);
          ctx.fillText(text, x, y + 0.5);
        };
        
        ctx.font = 'bold 14px Arial, sans-serif';
        drawThickText('Himpunan Mahasiswa', 90, 200);
        ctx.font = 'bold 13px Arial, sans-serif';
        drawThickText('Sistem Informasi UIGM', 90, 216);
        
        // QR Code on Right (size 170x170)
        const tempQrCanvas = document.createElement('canvas');
        tempQrCanvas.width = 170;
        tempQrCanvas.height = 170;
        // Use driveUrl directly — it's already a full redirect.html?p=... URL
        const finalUrl = driveUrl.trim();
        new QRious({
          element: tempQrCanvas,
          value: finalUrl,
          size: 170,
          background: 'white',
          foreground: 'black',
          level: 'H'
        });
        ctx.drawImage(tempQrCanvas, 209, 10, 170, 170);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.textAlign = 'center';
        drawThickText('Scan lihat semua foto', 294, 200);
      } else if (hasLogo) {
        // Only Logo Centered
        ctx.drawImage(logoImg, 132, 10, 120, 120);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Himpunan Mahasiswa', 192, 145);
        ctx.fillText('Sistem Informasi UIGM', 192, 160);
      } else if (showQr) {
        // Only QR Centered
        const tempQrCanvas = document.createElement('canvas');
        tempQrCanvas.width = 150;
        tempQrCanvas.height = 150;
        // Use driveUrl directly — it's already a full redirect.html?p=... URL
        const finalUrl = driveUrl.trim();
        new QRious({
          element: tempQrCanvas,
          value: finalUrl,
          size: 150,
          background: 'white',
          foreground: 'black',
          level: 'H'
        });
        ctx.drawImage(tempQrCanvas, 117, 10, 150, 150);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Scan lihat semua foto', 192, 175);
      }
      
      // Apply clean B&W dither/threshold to the header
      const imgData = ctx.getImageData(0, 0, 384, 216);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const a = data[i+3];
        
        if (a < 10) {
          // Transparent -> White
          data[i] = 255;
          data[i+1] = 255;
          data[i+2] = 255;
        } else {
          // Target yellow/gold tones and blue/navy tones specifically
          const isYellowGold = (r > 120 && g > 100 && b < 90);
          const isBlue = (b > r + 20 && b > g + 20);
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          
          let val;
          if (isBlue) {
            const pixelIdx = i / 4;
            const px = pixelIdx % 384;
            const py = Math.floor(pixelIdx / 384);
            
            // Case 1: Logo left (x: 5..175, y: 10..180)
            if (px >= 5 && px < 175 && py >= 10 && py < 180) {
              const dx = px - 90;
              const dy = py - 95;
              const dist = Math.sqrt(dx*dx + dy*dy);
              val = dist < 63 ? 255 : 0; // White inside center, Black for ribbon at bottom
            }
            // Case 2: Logo center (x: 132..252, y: 10..130)
            else if (px >= 132 && px < 252 && py >= 10 && py < 130) {
              const dx = px - 192;
              const dy = py - 70;
              const dist = Math.sqrt(dx*dx + dy*dy);
              val = dist < 44 ? 255 : 0; // White inside center, Black for ribbon at bottom
            } else {
              val = 255;
            }
          } else {
            val = (isYellowGold || gray > 175) ? 255 : 0;
          }
          
          data[i] = val;
          data[i+1] = val;
          data[i+2] = val;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      
      // Send header bands individually (NOT concatenated) to prevent buffer overflow
      const headerBands = getPrinterImageBands(headerCanvas);
      // We'll store header bands separately and send them one by one during print
      chunks.push({ type: 'image_bands', bands: headerBands });
      chunks.push(encoder.encode("\n"));
      chunks.push(encoder.encode(dividerText));
    }
    
    // 2. Date Time
    if (printSections.meta) {
      const dateText = new Date().toLocaleString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
      chunks.push(encoder.encode(dateText + "\n"));
      chunks.push(encoder.encode(dividerText));
    }
    
    // 3. Struk Title
    if (printSections.title) {
      chunks.push(new Uint8Array([0x1B, 0x45, 0x01])); // bold
      chunks.push(encoder.encode("FOTO STRUK KENANGAN\n" + (isCompact ? "" : "\n")));
      chunks.push(new Uint8Array([0x1B, 0x45, 0x00])); // unbold
    }
    
    // 4. Photos Canvas — send as individual bands with drain pauses
    if (photosCanvas) {
      const bands = getPrinterImageBands(photosCanvas);
      
      // Send header+text chunks first — handle image_bands separately
      for (const chunk of chunks) {
        if (chunk.type === 'image_bands') {
          // Send header image bands individually with proper pacing
          await writeImageBands(chunk.bands);
          await new Promise(r => setTimeout(r, 100));
        } else {
          await writeBytes(chunk);
          await new Promise(r => setTimeout(r, 20));
        }
      }
      await new Promise(r => setTimeout(r, 100)); // pause before photo image data
      
      // Send photo bands with drain pauses
      await writeImageBands(bands);
      await new Promise(r => setTimeout(r, 100)); // pause after image
      
      // Send remaining footer chunks
      const footerChunks = [];
      footerChunks.push(encoder.encode("\n"));
      
      // 5. Message Caption
      if (printSections.caption && captionText.trim() !== "") {
        footerChunks.push(encoder.encode(dividerText));
        footerChunks.push(new Uint8Array([0x1B, 0x61, 0x00]));
        footerChunks.push(encoder.encode(captionText.trim() + "\n"));
        footerChunks.push(new Uint8Array([0x1B, 0x61, 0x01]));
      }
      
      // 6. Footer Info
      if (printSections.footer) {
        footerChunks.push(encoder.encode(dividerText));
        footerChunks.push(new Uint8Array([0x1B, 0x45, 0x01]));
        footerChunks.push(encoder.encode("Terima Kasih Sudah Mampir\n"));
        footerChunks.push(new Uint8Array([0x1B, 0x45, 0x00]));
      }
      
      // Feed and cut
      footerChunks.push(encoder.encode("\n\n\n"));
      footerChunks.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00]));
      
      let footerLen = footerChunks.reduce((a, c) => a + c.length, 0);
      const footerBuffer = new Uint8Array(footerLen);
      let fOff = 0;
      for (const fc of footerChunks) {
        footerBuffer.set(fc, fOff);
        fOff += fc.length;
      }
      await writeBytes(footerBuffer);
      
    } else {
      chunks.push(encoder.encode("[ Tidak Ada Foto ]\n\n"));
      
      // 5. Message Caption
      if (printSections.caption && captionText.trim() !== "") {
        chunks.push(encoder.encode(dividerText));
        chunks.push(new Uint8Array([0x1B, 0x61, 0x00]));
        chunks.push(encoder.encode(captionText.trim() + "\n"));
        chunks.push(new Uint8Array([0x1B, 0x61, 0x01]));
      }
      
      // 6. Footer Info
      if (printSections.footer) {
        chunks.push(encoder.encode(dividerText));
        chunks.push(new Uint8Array([0x1B, 0x45, 0x01]));
        chunks.push(encoder.encode("Terima Kasih Sudah Mampir\n"));
        chunks.push(new Uint8Array([0x1B, 0x45, 0x00]));
      }
      
      chunks.push(encoder.encode("\n\n\n"));
      chunks.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00]));
      
      // Send chunks individually, handling image_bands separately
      for (const chunk of chunks) {
        if (chunk.type === 'image_bands') {
          await writeImageBands(chunk.bands);
          await new Promise(r => setTimeout(r, 100));
        } else {
          await writeBytes(chunk);
          await new Promise(r => setTimeout(r, 20));
        }
      }
    }
    
    return true;
  } catch (err) {
    console.error("Printing failed:", err);
    alert("Proses cetak gagal: " + err.message);
    return false;
  }
}
