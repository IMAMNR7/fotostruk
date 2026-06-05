import { useState, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ReceiptPreview from './components/ReceiptPreview';
import CameraModal from './components/CameraModal';
import { connectBluetooth, disconnectBluetooth, printViaBluetooth } from './utils/printer';

export default function App() {
  const getDefaultQrUrl = () => {
    if (window.location.port === '8080') {
      return 'http://localhost:8080/redirect.html';
    } else {
      let baseUrl = window.location.origin + window.location.pathname;
      if (baseUrl.endsWith('index.html')) {
        baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/'));
      }
      if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl.substring(0, baseUrl.length - 1);
      }
      const segments = baseUrl.split('/');
      if (segments[segments.length - 1] === 'dist') {
        segments.pop();
        baseUrl = segments.join('/');
      }
      return baseUrl + '/redirect.html';
    }
  };

  // Application State
  const [photosList, setPhotosList] = useState([]);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [filterMode, setFilterMode] = useState('dither');
  const [layoutMode, setLayoutMode] = useState('strip');
  
  // Paper Saver Options
  const [spacingMode, setSpacingMode] = useState('normal');
  const [printSections, setPrintSections] = useState({
    header: true,
    meta: false,
    title: false,
    caption: false,
    qr: true,
    footer: true
  });
  const [driveUrl, setDriveUrl] = useState(getDefaultQrUrl);
  const [captionText, setCaptionText] = useState('Kunjungan Stan Exhibition HIMSI');

  // Bluetooth State
  const [connectionStatus, setConnectionStatus] = useState('Terputus');
  
  // Camera Modal State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  
  // Printing & Uploading States
  const [isPrinting, setIsPrinting] = useState(false);
  const [uploadedQrUrl, setUploadedQrUrl] = useState('');

  // References for Canvas and Logo image
  const canvasRef = useRef(null);
  const logoImgRef = useRef(null);
  const sessionIdRef = useRef('');
  const syncTimeoutRef = useRef(null);

  // Sync photos to server in real-time
  const syncPhotosToServer = async (currentPhotos) => {
    if (currentPhotos.length === 0) {
      // If no photos left, and we have a session, clear the session on server
      if (sessionIdRef.current) {
        try {
          let uploadUrl = window.location.port === '8080' 
            ? 'http://localhost:5000/api/upload' 
            : window.location.origin + '/api/upload';
            
          await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: [], sessionId: sessionIdRef.current })
          });
        } catch (e) {
          console.error("Error clearing empty session:", e);
        }
      }
      setUploadedQrUrl('');
      return;
    }

    try {
      // Compress all photos to WebP
      const webpImages = currentPhotos.map(photo => 
        compressImageToWebp(photo.imgElement, 1000, 0.65)
      );

      // Determine upload API URL
      let uploadUrl;
      if (window.location.port === '8080') {
        uploadUrl = 'http://localhost:5000/api/upload';
      } else {
        uploadUrl = window.location.origin + '/api/upload';
      }

      const sessionIdToUse = sessionIdRef.current;

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          images: webpImages, 
          sessionId: sessionIdToUse || null 
        })
      });

      const result = await response.json();
      if (result.success) {
        sessionIdRef.current = result.id;
        
        let printUrl = result.url;
        if (window.location.port === '8080') {
          printUrl = `http://localhost:8080/redirect.html?id=${result.id}`;
        }
        setUploadedQrUrl(printUrl);
        console.log('Photos synced successfully. Session ID:', result.id);
      } else {
        console.error('Failed to sync photos:', result.message);
      }
    } catch (err) {
      console.error('Error syncing photos to server:', err);
    }
  };

  const triggerSync = (currentPhotos) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => {
      syncPhotosToServer(currentPhotos);
    }, 300);
  };

  // Handlers
  const handleAddPhoto = (newPhoto) => {
    setPhotosList(prev => {
      const updated = [...prev, newPhoto];
      triggerSync(updated);
      return updated;
    });
  };

  const handleRemovePhoto = (idx) => {
    setPhotosList(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      triggerSync(updated);
      return updated;
    });
  };

  const handleReset = () => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    setPhotosList([]);
    setBrightness(0);
    setContrast(0);
    setFilterMode('dither');
    setLayoutMode('strip');
    setSpacingMode('normal');
    setPrintSections({
      header: true,
      meta: false,
      title: false,
      caption: false,
      qr: true,
      footer: true
    });
    setDriveUrl(getDefaultQrUrl());
    setCaptionText('Kunjungan Stan Exhibition HIMSI');
    setUploadedQrUrl('');
    sessionIdRef.current = '';
  };

  const handleConnect = async () => {
    try {
      await connectBluetooth(setConnectionStatus);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDisconnect = async () => {
    await disconnectBluetooth(setConnectionStatus);
  };

  // Helper to compress image to a small, lightweight WebP (under 50KB)
  const compressImageToWebp = (imgElement, maxDim = 1000, quality = 0.65) => {
    const canvas = document.createElement('canvas');
    let w = imgElement.naturalWidth;
    let h = imgElement.naturalHeight;
    
    // Resize maintaining aspect ratio
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0, w, h);
    return canvas.toDataURL('image/webp', quality);
  };

  const handlePrint = async () => {
    setIsPrinting(true);

    // The print URL is already uploadedQrUrl (synced in real-time) or falls back to default driveUrl
    const finalPrintUrl = (photosList.length > 0 && uploadedQrUrl) ? uploadedQrUrl : driveUrl;

    const success = await printViaBluetooth(
      canvasRef.current,
      logoImgRef.current,
      finalPrintUrl,
      printSections,
      spacingMode,
      captionText
    );

    if (success) {
      console.log('Printed successfully!');
    }
    setIsPrinting(false);
  };

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#090d16', color: '#f8fafc' }}>
      
      {/* Sidebar Panel */}
      <Sidebar
        photosList={photosList}
        onAddPhoto={handleAddPhoto}
        onRemovePhoto={handleRemovePhoto}
        onReset={handleReset}
        brightness={brightness}
        setBrightness={setBrightness}
        contrast={contrast}
        setContrast={setContrast}
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
        printSections={printSections}
        setPrintSections={setPrintSections}
        spacingMode={spacingMode}
        setSpacingMode={setSpacingMode}
        captionText={captionText}
        setCaptionText={setCaptionText}
        connectionStatus={connectionStatus}
        onConnectBluetooth={handleConnect}
        onDisconnectBluetooth={handleDisconnect}
        onPrint={handlePrint}
        onOpenCameraModal={() => setIsCameraOpen(true)}
        isPrinting={isPrinting}
      />

      {/* Main Preview Panel */}
      <main className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflowY: 'auto' }}>
        <header className="app-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <a 
              href="https://www.instagram.com/himsi.uigm" 
              target="_blank" 
              rel="noopener noreferrer"
              className="logo-container" 
              style={{ 
                width: '40px', 
                height: '40px', 
                background: 'rgba(255,255,255,0.03)', 
                borderRadius: '10px', 
                padding: '4px', 
                display: 'block',
                transition: 'all 0.2s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <img src="logo_himsi.png" alt="HIMSI Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </a>
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>FotoStruk Web React</h1>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>Printer Thermal HIMSI UIGM</p>
            </div>
          </div>
          <a 
            href="https://drive.google.com/drive/folders/15xqUbLFQEa0n1y-Vt_hT7meTm3BQ2dol?usp=sharing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              fontSize: '0.85rem', 
              fontWeight: 600,
              textDecoration: 'none',
              background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1), rgba(0, 200, 83, 0.1))',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '0.5rem 0.85rem'
            }}
          >
            <svg viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" style={{ width: '16px', height: '16px' }}>
              <path d="m6.6 66.85 15.4-26.7a4 4 0 0 1 3.5-2h43.35l-15.4 26.7a4 4 0 0 1 -3.5 2h-39.85a4 4 0 0 1 -3.5-2z" fill="#0066da"/>
              <path d="m51.95 24.15 15.4-26.7a4 4 0 0 1 3.5-2h12.35a4 4 0 0 1 3.5 6l-31 53.7a4 4 0 0 1 -7 0l-12.35-21.4a4 4 0 0 1 0-4z" fill="#00a1ff"/>
              <path d="m22 38.15-15.4-26.7a4 4 0 0 1 0-4l6.15-10.7a4 4 0 0 1 7 0l31 53.7a4 4 0 0 1 -3.5 6h-24.7a4 4 0 0 1 -3.5-2z" fill="#00ddb6"/>
            </svg>
            <span>Google Drive</span>
          </a>
        </header>

        <ReceiptPreview
          photosList={photosList}
          brightness={brightness}
          contrast={contrast}
          filterMode={filterMode}
          layoutMode={layoutMode}
          printSections={printSections}
          spacingMode={spacingMode}
          driveUrl={uploadedQrUrl || driveUrl}
          captionText={captionText}
          canvasRef={canvasRef}
          logoImgRef={logoImgRef}
        />

        <footer className="app-footer">
          <p>&copy; {new Date().getFullYear()} HIMSI UIGM. All rights reserved.</p>
        </footer>
      </main>

      {/* Camera Capture Modal */}
      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(dataUrl) => {
          const img = new Image();
          img.onload = () => {
            handleAddPhoto({
              id: Date.now() + Math.random(),
              src: dataUrl,
              imgElement: img
            });
          };
          img.src = dataUrl;
        }}
      />
    </div>
  );
}
