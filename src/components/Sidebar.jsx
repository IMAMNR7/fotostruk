import { useRef } from 'react';
import { Upload, Camera, Bluetooth, Printer, RefreshCw } from 'lucide-react';

export default function Sidebar({
  photosList,
  onAddPhoto,
  onRemovePhoto,
  onTogglePrintSelect,
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
      
      if (photosList.length >= 20) {
        alert("Maksimal 20 foto telah tercapai. Hapus beberapa foto untuk menambah baru!");
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
    <aside className="sidebar">
      
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
                <span>{photosList.length} foto ({photosList.filter(p => p.selectedForPrint).length} untuk cetak)</span>
              </div>
              <div className="thumbnail-grid">
                {photosList.map((photo, idx) => (
                  <div 
                    key={photo.id} 
                    className="thumbnail-item" 
                    onClick={() => onTogglePrintSelect(idx)}
                    style={{ 
                      border: photo.selectedForPrint 
                        ? '2px solid #3b82f6' 
                        : '2px solid rgba(255,255,255,0.1)',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                  >
                    <img src={photo.src} alt="Thumbnail" style={{
                      opacity: photo.selectedForPrint ? 1 : 0.4,
                      transition: 'opacity 0.2s ease'
                    }} />
                    {/* Dim overlay when not selected */}
                    {!photo.selectedForPrint && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        borderRadius: 'inherit',
                        pointerEvents: 'none'
                      }} />
                    )}
                    {/* Print selection checkbox — large and easy to see */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '4px',
                        left: '4px',
                        width: '26px',
                        height: '26px',
                        borderRadius: '6px',
                        background: photo.selectedForPrint ? '#3b82f6' : 'rgba(100,116,139,0.7)',
                        color: 'white',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.3)'
                      }}
                    >
                      {photo.selectedForPrint ? '✓' : ''}
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onRemovePhoto(idx); }}
                      className="thumbnail-delete"
                      title="Hapus foto"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.4rem', textAlign: 'center' }}>
                Ketuk foto untuk pilih/batal cetak
              </p>
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
