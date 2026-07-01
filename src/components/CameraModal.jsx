import { useRef, useState, useEffect } from 'react';
import { Camera, X } from 'lucide-react';

export default function CameraModal({ isOpen, onClose, onCapture }) {
  const videoRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [facingMode, setFacingMode] = useState('user'); // 'user' (front) or 'environment' (back)
  const [stream, setStream] = useState(null);
  const [error, setError] = useState('');
  const [mirrorCapture, setMirrorCapture] = useState(false); // default to false (jangan mirror)


  // Manage camera streaming lifecycle
  useEffect(() => {
    if (!isOpen) return;

    let activeStream = null;

    async function setupCamera() {
      try {
        const constraints = {
          video: selectedDeviceId 
            ? { deviceId: { exact: selectedDeviceId } }
            : { facingMode: facingMode }
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = mediaStream;
        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }

        // List devices if not already done
        if (devices.length === 0) {
          const devs = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = devs.filter(d => d.kind === 'videoinput');
          setDevices(videoDevs);

          // Auto-select current deviceId
          if (videoDevs.length > 0 && !selectedDeviceId) {
            const activeTrack = mediaStream.getVideoTracks()[0];
            const activeSettings = activeTrack ? activeTrack.getSettings() : null;
            const currentDeviceId = (activeSettings && activeSettings.deviceId) 
              ? activeSettings.deviceId 
              : videoDevs[0].deviceId;
            setSelectedDeviceId(currentDeviceId);
          }
        }
        
        setError('');
      } catch (err) {
        console.error('Error starting video stream:', err);
        setError('Gagal mengakses kamera: ' + err.message);
      }
    }

    setupCamera();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isOpen, selectedDeviceId, devices.length, facingMode]);

  // Clean up streams when modal closes
  const handleClose = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    onClose();
  };

  const handleCapture = () => {
    if (!videoRef.current || !stream) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Draw mirrored or normal based on settings
    if (facingMode === 'user' && !mirrorCapture) {
      // Flip horizontally to get an unmirrored (normal) image
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    
    // Draw the current video frame on canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL('image/png');
    onCapture(dataUrl);
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(8px)'
    }}>
      <div className="modal-content card" style={{
        maxWidth: '500px',
        width: '100%',
        padding: '1.5rem',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: '#0f172a',
        color: '#f8fafc',
        position: 'relative'
      }}>
        <button onClick={handleClose} style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          background: 'none',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer'
        }}>
          <X size={20} />
        </button>

        <h3 style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <Camera size={20} style={{ color: '#3b82f6' }} />
          Ambil Foto dari Kamera
        </h3>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {devices.length > 0 && (
            <div style={{ flex: 1, minWidth: '150px' }}>
              <label style={{ fontSize: '0.85rem', color: '#94a3b8', display: 'block', marginBottom: '0.4rem' }}>Pilih Kamera:</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => {
                  setSelectedDeviceId(e.target.value);
                  const selectedDevice = devices.find(d => d.deviceId === e.target.value);
                  if (selectedDevice && selectedDevice.label) {
                    const label = selectedDevice.label.toLowerCase();
                    if (label.includes('front') || label.includes('depan') || label.includes('user')) {
                      setFacingMode('user');
                    } else if (label.includes('back') || label.includes('belakang') || label.includes('environment')) {
                      setFacingMode('environment');
                    }
                  }
                }}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8fafc',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              >
                {devices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Kamera ${devices.indexOf(device) + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          <button
            onClick={() => {
              setSelectedDeviceId('');
              setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
            }}
            style={{
              padding: '0.6rem 1rem',
              borderRadius: '8px',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              background: 'rgba(59, 130, 246, 0.1)',
              color: '#3b82f6',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              height: '38px',
              whiteSpace: 'nowrap'
            }}
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 22v-6h6"/><path d="M21 13a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 11a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/></svg>
            Putar ({facingMode === 'user' ? 'Depan' : 'Belakang'})
          </button>

          {facingMode === 'user' && (
            <button
              onClick={() => setMirrorCapture(prev => !prev)}
              style={{
                padding: '0.6rem 1rem',
                borderRadius: '8px',
                border: mirrorCapture 
                  ? '1px solid rgba(59, 130, 246, 0.3)' 
                  : '1px solid rgba(255, 255, 255, 0.1)',
                background: mirrorCapture 
                  ? 'rgba(59, 130, 246, 0.1)' 
                  : 'rgba(255, 255, 255, 0.05)',
                color: mirrorCapture ? '#3b82f6' : '#94a3b8',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                height: '38px',
                whiteSpace: 'nowrap'
              }}
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12A10 10 0 1 1 12 2v10z"/><path d="M12 2a10 10 0 0 1 10 10H12z"/></svg>
              {mirrorCapture ? 'Foto: Mirror' : 'Foto: Normal (Jangan Mirror)'}
            </button>
          )}
        </div>

        {error ? (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            padding: '1rem',
            borderRadius: '10px',
            color: '#f87171',
            fontSize: '0.9rem',
            textAlign: 'center',
            marginBottom: '1rem'
          }}>
            {error}
          </div>
        ) : (
          <div style={{
            width: '100%',
            aspectRatio: '4/3',
            borderRadius: '12px',
            overflow: 'hidden',
            background: '#020617',
            marginBottom: '1.25rem',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
          }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            onClick={handleClose}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'transparent',
              color: '#94a3b8',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            Batal
          </button>
          <button
            onClick={handleCapture}
            disabled={!!error || !stream}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '10px',
              border: 'none',
              background: '#3b82f6',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer',
              opacity: (!!error || !stream) ? 0.5 : 1
            }}
          >
            Ambil Foto
          </button>
        </div>
      </div>
    </div>
  );
}
