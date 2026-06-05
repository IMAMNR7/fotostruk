import { useRef } from 'react';
import { Upload, Camera, Bluetooth, Printer, RefreshCw } from 'lucide-react';

export default function Sidebar({
  photosList,
  onAddPhoto,
  onRemovePhoto,
  onReset,
  connectionStatus,
  onConnectBluetooth,
  onDisconnectBluetooth,
  onPrint,
  onOpenCameraModal,
  isPrinting = false
}) {
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const handleFileChange = (e) => {
    handleFiles(e.target.files);
  };

  const handleFiles = (files) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      
      if (photosList.length >= 6) {
        alert("Maksimal 6 foto telah tercapai. Hapus beberapa foto untuk menambah baru!");
        break;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          onAddPhoto({
            id: Date.now() + Math.random(),
            src: e.target.result,
            imgElement: img
          });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <aside className="sidebar" style={{ width: '380px', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
      
      {/* 1. Bluetooth Connection Panel */}
      <div className="card card-bluetooth">
        <div className="card-header">
          <Bluetooth className="card-icon" />
          <h2>Printer Bluetooth</h2>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Status Koneksi:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                <span className={`status-dot ${connectionStatus === 'Terhubung' ? 'status-connected' : connectionStatus === 'Menghubungkan...' ? 'status-connecting' : 'status-disconnected'}`} />
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{connectionStatus}</span>
              </div>
            </div>
            {connectionStatus === 'Terhubung' ? (
              <button 
                onClick={onDisconnectBluetooth} 
                className="btn btn-secondary" 
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                Putuskan
              </button>
            ) : (
              <button 
                onClick={onConnectBluetooth} 
                className="btn btn-primary"
                disabled={connectionStatus === 'Menghubungkan...'}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                Sambungkan
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Media Inputs Panel */}
      <div className="card">
        <div className="card-header">
          <Upload className="card-icon" style={{ color: '#10b981' }} />
          <h2>Sumber Media & Foto</h2>
        </div>
        <div className="card-body">
          
          {/* Drag & Drop Upload box */}
          <div 
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="upload-area"
          >
            <Upload size={24} style={{ color: '#64748b', marginBottom: '0.5rem' }} />
            <p className="font-bold" style={{ fontSize: '0.9rem', marginBottom: '0.2rem' }}>Tarik & Lepas Foto</p>
            <p style={{ fontSize: '0.75rem', color: '#64748b' }}>atau klik untuk telusuri file</p>
            <input 
              ref={fileInputRef}
              type="file" 
              multiple 
              accept="image/*" 
              onChange={handleFileChange}
              style={{ display: 'none' }} 
            />
          </div>

          {/* Webcam trigger */}
          <button 
            onClick={onOpenCameraModal}
            className="btn btn-secondary"
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifycontent: 'center', gap: '0.5rem' }}
          >
            <Camera size={18} />
            Ambil Foto dari Webcam
          </button>

          {/* Thumbnail list */}
          {photosList.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.4rem' }}>
                <span>Foto Terpilih:</span>
                <span>{photosList.length} / 6 foto</span>
              </div>
              <div className="thumbnail-grid">
                {photosList.map((photo, idx) => (
                  <div key={photo.id} className="thumbnail-item">
                    <img src={photo.src} alt="Thumbnail" />
                    <button 
                      onClick={() => onRemovePhoto(idx)}
                      className="thumbnail-delete"
                      title="Hapus foto"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>



      {/* 4. Primary Action Buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto', paddingBottom: '0.5rem' }}>
        <button 
          onClick={onReset}
          className="btn btn-secondary"
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <RefreshCw size={16} />
          Reset
        </button>
        <button 
          onClick={onPrint}
          disabled={isPrinting}
          className="btn btn-primary"
          style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', opacity: isPrinting ? 0.7 : 1 }}
        >
          {isPrinting ? (
            <>
              <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
              Proses...
            </>
          ) : (
            <>
              <Printer size={18} />
              Cetak
            </>
          )}
        </button>
      </div>

    </aside>
  );
}
