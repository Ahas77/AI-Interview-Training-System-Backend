const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure upload directory exists outside public access
const uploadDir = path.join(__dirname, "../../uploads/cvs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user ? req.user.id : "user";
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const safeFilename = `cv_${userId}_${uniqueSuffix}${ext}`;
    cb(null, safeFilename);
  },
});

// File filter for validation
const fileFilter = (req, file, cb) => {
  const allowedExtensions = [".pdf", ".docx", ".doc"];
  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/octet-stream",
  ];

  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  if (!allowedExtensions.includes(ext)) {
    return cb(
      new Error("Invalid file extension. Only PDF and DOCX files are allowed."),
      false
    );
  }

  if (!allowedMimeTypes.includes(mimeType)) {
    return cb(
      new Error("Invalid MIME type. Only PDF and DOCX documents are allowed."),
      false
    );
  }

  cb(null, true);
};

// 10 MB limit
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// Wrap multer to format error responses nicely
const cvUploadMiddleware = (req, res, next) => {
  const singleUpload = upload.single("cv");

  singleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File size exceeds the 10MB limit.",
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`,
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "File upload validation failed.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No CV file was uploaded. Please attach a PDF or DOCX file.",
      });
    }

    next();
  });
};

module.exports = { cvUploadMiddleware };
