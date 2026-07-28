const express = require("express");
const path = require("path");

const systemRouter = require("./system");
const malRouter = require("./mal");
const downloadsRouter = require("./downloads");
const mediaRouter = require("./media");
const libraryRouter = require("./library");

const router = express.Router();

router.use(systemRouter);
router.use(malRouter);
router.use(downloadsRouter);
router.use(mediaRouter);
router.use(libraryRouter);

// SPA fallback routes
const SPA_ROUTES = [
  "/",
  "/local/anime",
  "/local/manga",
  "/anime",
  "/mal/anime",
  "/manga",
  "/search",
  "/setting",
  "/log",
  "/info/:AnimeManga/:LocalMalProvider",
  "/downloads",
  "/marketplace",
  "/error",
];

SPA_ROUTES.forEach((route) => {
  router.get(route, (req, res) => {
    res.sendFile(
      path.join(__dirname, "..", "..", "gui", "dist", "index.html"),
      { dotfiles: "allow" },
    );
  });
});

module.exports = router;
