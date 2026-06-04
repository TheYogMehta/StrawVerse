const { ipcMain } = require("electron");
const { UpdateDiscordRPC } = require("./utils/discord");
const { HandleExtensions } = require("./utils/settings");

let PageHistory = [];
let OldRpcStatus = null;

function registerSharedStateHandlers() {
  ipcMain.handle("get-shared-state", () => {
    return PageHistory;
  });

  ipcMain.handle("set-shared-state", (event, newPageHistory) => {
    PageHistory = newPageHistory;
    if (OldRpcStatus) {
      UpdateDiscordRPC();
      OldRpcStatus = null;
    }
    return PageHistory;
  });

  ipcMain.handle("update-discordrpc", (event, AnimeName, Episode) => {
    NewRpcStatus = `${AnimeName}${Episode}`;
    if (OldRpcStatus !== NewRpcStatus) {
      OldRpcStatus = NewRpcStatus;
      UpdateDiscordRPC(AnimeName, Episode);
    }
  });

  ipcMain.handle(
    "extensions",
    async (event, TaskType, AnimeManga, ExtentionName) => {
      return await HandleExtensions(TaskType, AnimeManga, ExtentionName);
    },
  );
}

module.exports = { registerSharedStateHandlers };
