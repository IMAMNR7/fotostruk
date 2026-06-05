const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and body size configuration
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads base folder exists
const uploadBaseDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadBaseDir)) {
  fs.mkdirSync(uploadBaseDir, { recursive: true });
}

// Serve static uploads
app.use('/uploads', express.static(uploadBaseDir));

// Serve compiled React build in production
app.use(express.static(path.join(__dirname, 'dist')));

// API: Upload WebP Photos
app.post('/api/upload', (req, res) => {
  const { images, sessionId } = req.body;
  
  if (!images || !Array.isArray(images)) {
    return res.status(400).json({
      success: false,
      message: "Invalid payload. Expected an array of base64 images."
    });
  }

  try {
    let cleanSessionId = sessionId;
    if (cleanSessionId) {
      cleanSessionId = cleanSessionId.replace(/[^a-zA-Z0-9_]/g, '');
    }
    
    // Generate new session ID if not provided
    const targetSessionId = cleanSessionId || ('session_' + crypto.randomBytes(6).toString('hex'));
    const sessionDir = path.join(uploadBaseDir, targetSessionId);
    
    // Clear/delete existing webp files in the folder if we are updating the session
    if (cleanSessionId && fs.existsSync(sessionDir)) {
      const existingFiles = fs.readdirSync(sessionDir);
      existingFiles.forEach(file => {
        if (file.endsWith('.webp')) {
          try {
            fs.unlinkSync(path.join(sessionDir, file));
          } catch (e) {
            console.error(`Error deleting file ${file}:`, e);
          }
        }
      });
    } else {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    let savedCount = 0;
    images.forEach((base64Data, index) => {
      const matches = base64Data.match(/^data:image\/(\w+);base64,/);
      if (matches) {
        const dataBuffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ""), 'base64');
        
        // Save as webp
        const filename = `photo_${index + 1}.webp`;
        const filepath = path.join(sessionDir, filename);
        
        fs.writeFileSync(filepath, dataBuffer);
        savedCount++;
      }
    });

    if (savedCount === 0 && !cleanSessionId) {
      try {
        fs.rmdirSync(sessionDir);
      } catch (e) {}
      return res.status(400).json({
        success: false,
        message: "Failed to save any uploaded images."
      });
    }

    const host = req.get('host');
    const protocol = req.protocol;
    const redirectUrl = `${protocol}://${host}/redirect.html?id=${targetSessionId}`;

    return res.json({
      success: true,
      id: targetSessionId,
      url: redirectUrl,
      count: savedCount
    });

  } catch (err) {
    console.error("Upload handler error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error during upload."
    });
  }
});

// Helper function to get all photos from uploads
function getAllPhotos() {
  const photos = [];
  if (!fs.existsSync(uploadBaseDir)) return photos;

  const items = fs.readdirSync(uploadBaseDir);
  items.forEach(item => {
    const itemPath = path.join(uploadBaseDir, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
      const files = fs.readdirSync(itemPath);
      files.forEach(file => {
        if (file.endsWith('.webp')) {
          const filePath = path.join(itemPath, file);
          const fileStat = fs.statSync(filePath);
          photos.push({
            path: `${item}/${file}`,
            filename: file,
            sessionId: item,
            mtime: fileStat.mtimeMs
          });
        }
      });
    } else if (stat.isFile() && item.endsWith('.webp')) {
      photos.push({
        path: item,
        filename: item,
        sessionId: 'shared',
        mtime: stat.mtimeMs
      });
    }
  });

  // Sort by modification time, newest first
  photos.sort((a, b) => b.mtime - a.mtime);
  return photos;
}

// API: Retrieve Photos / Zip Download
app.get('/api/photos', (req, res) => {
  const { id, action } = req.query;

  try {
    const allPhotos = getAllPhotos();

    // Handle ZIP Action
    if (action === 'zip') {
      const zip = new AdmZip();
      
      // If a specific session ID is requested for zip, filter by it. Otherwise zip all.
      const targetPhotos = id 
        ? allPhotos.filter(p => p.sessionId === id.replace(/[^a-zA-Z0-9_]/g, '')) 
        : allPhotos;

      if (targetPhotos.length === 0) {
        return res.status(404).json({ success: false, message: "No photos found to zip." });
      }

      targetPhotos.forEach(p => {
        const fullPath = path.join(uploadBaseDir, p.path);
        if (fs.existsSync(fullPath)) {
          // Name file inside ZIP as sessionID_filename to avoid name collisions
          const zipFileName = p.sessionId ? `${p.sessionId}_${p.filename}` : p.filename;
          zip.addLocalFile(fullPath, '', zipFileName);
        }
      });

      const zipBuffer = zip.toBuffer();
      const zipName = id ? `foto_struk_${id}.zip` : `foto_struk_semua.zip`;

      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
        'Content-Length': zipBuffer.length,
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return res.send(zipBuffer);
    }

    // Default: Return list of all photos
    return res.json({
      success: true,
      photos: allPhotos
    });

  } catch (err) {
    console.error("Photos handler error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error retrieving photos."
    });
  }
});

// Served as static files by express.static

app.listen(PORT, () => {
  console.log(`FotoStruk unified server is running on http://localhost:${PORT}`);
});
