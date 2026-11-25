if (typeof global.sendToRenderer !== "function") {
  global.sendToRenderer = () => {};
}

const express = require("express");
const path = require("path");

const { isAndroid } = require("../utils/constants");

const systemRouter = require("./system");
const malRouter = require("./mal");
const downloadsRouter = require("./downloads");
const mediaRouter = require("./media");
const libraryRouter = require("./library");
const castRouter = require("./cast");

const router = express.Router();

// Mount sub-routers
router.use(systemRouter);
router.use(malRouter);
router.use(downloadsRouter);
router.use(mediaRouter);
router.use(libraryRouter);
router.use(castRouter);

// Android only APK update router
if (isAndroid) {
  const updateRouter = require("./update");
  router.use(updateRouter);
}

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
