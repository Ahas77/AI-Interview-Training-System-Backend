const express = require("express");
const router = express.Router();
const companyRequirementsController = require("../controllers/companyRequirementsController");
const { verifyToken } = require("../middleware/authMiddleware");

// Real-time search and requirements extraction (authenticated)
router.post("/search", verifyToken, companyRequirementsController.searchRequirements);

// List recent verified postings
router.get("/", verifyToken, companyRequirementsController.listRecentPostings);

// Get requirements for specific company
router.get("/:companyId", verifyToken, companyRequirementsController.getCompanyRequirements);

module.exports = router;
