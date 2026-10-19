const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/authMiddleware");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/logout", authController.logout);
router.get("/me", verifyToken, authController.getProfile);
router.get("/profile", verifyToken, authController.getProfile);
router.post("/update_profile", verifyToken, authController.updateProfile);
router.post("/profile-reset-password", verifyToken, authController.profileResetPassword);

module.exports = router;
