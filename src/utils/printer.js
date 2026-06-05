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

// Packages canvas pixel data to ESC/POS GS v 0 binary format
export function getPrinterImageBytes(canvasElement) {
  const ctx = canvasElement.getContext('2d');
  const width = canvasElement.width; // e.g. 384
  const height = canvasElement.height;
  
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  
  const xBytes = Math.floor(width / 8);
  const xL = xBytes % 256;
  const xH = Math.floor(xBytes / 256);
  const yL = height % 256;
  const yH = Math.floor(height / 256);
  
  // ESC/POS header for raster bit image print command: GS v 0 0 xL xH yL yH
  const header = new Uint8Array([0x1D, 0x76, 0x30, 0, xL, xH, yL, yH]);
  
  const buffer = [];
  for (let y = 0; y < height; y++) {
    for (let xByte = 0; xByte < xBytes; xByte++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = xByte * 8 + bit;
        const pixelIdx = (y * width + x) * 4;
        
        let isBlack = 0;
        if (pixelIdx < data.length) {
          const r = data[pixelIdx];
          const g = data[pixelIdx + 1];
          const b = data[pixelIdx + 2];
          const a = data[pixelIdx + 3];
          
          if (a >= 10) {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            if (gray < 128) {
              isBlack = 1;
            }
          }
        }
        byteVal |= (isBlack << (7 - bit));
      }
      buffer.push(byteVal);
    }
  }
  
  const combined = new Uint8Array(header.length + buffer.length);
  combined.set(header, 0);
  combined.set(new Uint8Array(buffer), header.length);
  return combined;
}

// Connect to a Web Bluetooth BLE thermal printer
export async function connectBluetooth(onStatusChange) {
  try {
    onStatusChange('Menghubungkan...');
    
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ['000018f0-0000-1000-8000-00805f9b34fb'] },
        { services: ['49535343-fe7d-4ae5-8fa9-9fafd205e455'] }
      ],
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
        '49535343-fe7d-4ae5-8fa9-9fafd205e455'
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

// Send printing binary packets chunk-by-chunk to the printer
async function writeBytes(data) {
  if (!bleCharacteristic) return;
  
  const hasWithoutResponse = bleCharacteristic.properties.writeWithoutResponse;
  const maxChunkSize = 120; // 120-byte payload is fast and safe for BLE printers
  let offset = 0;
  
  while (offset < data.length) {
    const chunk = data.slice(offset, offset + maxChunkSize);
    if (hasWithoutResponse) {
      await bleCharacteristic.writeValueWithoutResponse(chunk);
      // Small 5ms delay to prevent overflow in write without response
      await new Promise(r => setTimeout(r, 5));
    } else {
      await bleCharacteristic.writeValue(chunk);
      // No extra delay needed for write with response as await resolves after GATT ack
    }
    offset += maxChunkSize;
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
      headerCanvas.height = 230;
      const ctx = headerCanvas.getContext('2d');
      
      // White canvas background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 384, 230);
      
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
        const finalUrl = getRedirectUrl(driveUrl.trim());
        new QRious({
          element: tempQrCanvas,
          value: finalUrl,
          size: 170,
          background: 'white',
          foreground: 'black',
          level: 'M'
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
        const finalUrl = getRedirectUrl(driveUrl.trim());
        new QRious({
          element: tempQrCanvas,
          value: finalUrl,
          size: 150,
          background: 'white',
          foreground: 'black',
          level: 'M'
        });
        ctx.drawImage(tempQrCanvas, 117, 10, 150, 150);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Scan lihat semua foto', 192, 175);
      }
      
      // Apply clean B&W dither/threshold to the header
      const imgData = ctx.getImageData(0, 0, 384, 190);
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
      
      const headerBytes = getPrinterImageBytes(headerCanvas);
      chunks.push(headerBytes);
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
    
    // 4. Photos Canvas
    if (photosCanvas) {
      const imgBytes = getPrinterImageBytes(photosCanvas);
      chunks.push(imgBytes);
      chunks.push(encoder.encode("\n"));
    } else {
      chunks.push(encoder.encode("[ Tidak Ada Foto ]\n\n"));
    }
    
    // 5. Message Caption
    if (printSections.caption && captionText.trim() !== "") {
      chunks.push(encoder.encode(dividerText));
      chunks.push(new Uint8Array([0x1B, 0x61, 0x00])); // left align
      chunks.push(encoder.encode(captionText.trim() + "\n"));
      chunks.push(new Uint8Array([0x1B, 0x61, 0x01])); // center align
    }
    
    // 6. Footer Info
    if (printSections.footer) {
      chunks.push(encoder.encode(dividerText));
      chunks.push(new Uint8Array([0x1B, 0x45, 0x01])); // bold
      chunks.push(encoder.encode("Terima Kasih Sudah Mampir\n"));
      chunks.push(new Uint8Array([0x1B, 0x45, 0x00])); // unbold
    }
    
    // Feed and cut paper commands
    chunks.push(encoder.encode("\n\n\n"));
    chunks.push(new Uint8Array([0x1D, 0x56, 0x42, 0x00])); // Feed paper and cut
    
    // Concatenate all chunks
    let totalLength = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const resultBuffer = new Uint8Array(totalLength);
    let currentOffset = 0;
    for (const chunk of chunks) {
      resultBuffer.set(chunk, currentOffset);
      currentOffset += chunk.length;
    }
    
    // Send to Bluetooth characteristics
    await writeBytes(resultBuffer);
    return true;
  } catch (err) {
    console.error("Printing failed:", err);
    alert("Proses cetak gagal: " + err.message);
    return false;
  }
}
