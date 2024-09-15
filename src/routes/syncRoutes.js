const express = require("express");
const { handleSync } = require("../controllers/syncController");
const { updateSheet } = require("../controllers/updateSheetController");
const { logChange } = require("../controllers/logController");

const router = express.Router();

router.post("/sync", handleSync);
router.post("/update-cell", updateSheet)
router.post("/log-change", logChange);

module.exports = router;
