<h6 align="right">💻 Support Windows & Linux</h6>
<h1 align="center">
  <img src="https://capsule-render.vercel.app/api?type=soft&fontColor=703ee5&text=StrawVerse&height=150&fontSize=40&desc=Ridiculously%20efficient,%20fast%20and%20light-weight.&descAlignY=75&descAlign=50&color=00000000&animation=twinkling">
</h1>

<p align="center">
  <a href="https://discord.gg/PzfUBgQ2gt">
    <img src="https://img.shields.io/discord/1514335663875555470?color=7289da&label=Discord&logo=discord&style=for-the-badge" alt="Discord">
  </a>
</p>

> [!IMPORTANT]
> **Legal Disclaimer:** StrawVerse is an open-source local media manager and indexing application designed for developers and researchers. The developers of this application do not host, store, stream, or distribute any copyrighted media (video, audio, or images). The application functions solely as a client-side parser and downloader wrapper utilizing publicly available web resource links. We do not condone, promote, or encourage copyright infringement. By using this software, you acknowledge and agree that all download and media-access activities are conducted at your own risk and responsibility, and that you are solely responsible for ensuring compliance with all local, national, and international copyright laws and terms of service.

## Table of Contents 📖

- [Overview](#overview)
- [Features](#features)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Videos](#videos)
  - [Download Guide](#how-to-download-animedownloaderexe)
  - [Anime Download Guide](#how-to-download-anime-from-animedownloaderexe)
- [Configuration](#configuration)
- [Uninstalling the Application](#uninstalling-the-application)
- [Build the Application](#Build-the-Application)
  - [Prerequisites](#prerequisites)
  - [Steps to Build](#steps-to-build)

---

## Overview

This is a Node.js-based anime & manga downloader that allows you to download anime episodes in bulk, quickly, and from the multiple sources. Additionally, it has the functionality to automatically add the downloaded anime to your MyAnimeList plan-to-watch list. The downloader supports both dubbed (dub) and subtitled (sub) versions for anime. For manga, it downloads chapters from Mangasee123 and saves them in cbz format.

### Features

- **Bulk Downloading:** Download multiple anime episodes and manga chapters in one go.
- **Fast and Efficient:** Enjoy a ridiculously efficient, fast, and light-weight downloader.
- **Dub and Sub Options:** Download either dubbed or subtitled versions based on your preference for anime.
- **MyAnimeList Integration:** Automatically add downloaded anime to your MyAnimeList plan-to-watch list.
- **Manga Downloading:** Download manga chapters from Mangasee123 in cbz format.

## System Requirements

- **Operating System:** Windows & Linux

## Installation

### 💻 For Windows:

1. Go to [StrawVerse Releases](https://github.com/TheYogMehta/StrawVerse/releases).
2. Download the setup file `StrawVerse.Setup.<version>.exe`.
3. Run the installer to install the application, and enjoy!

### 🐧 For Linux:

1. Go to [StrawVerse Releases](https://github.com/TheYogMehta/StrawVerse/releases).
2. Download the AppImage `StrawVerse-<version>.AppImage` or the snap package.
3. For AppImage: Make it executable using `chmod +x StrawVerse-<version>.AppImage` and run it.

### 🍎 For Other OS (macOS, etc.):

- Pre-built binaries are not currently provided. You can run the application by cloning the repository, installing the dependencies, and running it locally. See the **[Build the Application](#build-the-application)** section below for step-by-step instructions.

## Usage

1. Run the application (`StrawVerse.exe` on Windows, or `StrawVerse.AppImage` / Snap on Linux).
2. Search through the anime or manga list and download what you like.
3. See progress in the downloads tab.
4. Anime episodes will be downloaded in the folder where you have stored/run the executable (or in your configured download directory).
5. Manga chapters will be saved as `.cbz` files in your designated folder.

## Videos

### How to download `StrawVerse.exe`?

[Download Guide Video](https://github.com/Incredibleflamer/Anime-batch-downloader-gui/assets/84078595/662413b3-cf34-49d1-a99d-4c5e42330d05)

### How to download anime from `StrawVerse.exe`?

[Anime Download Guide Video](https://github.com/Incredibleflamer/Anime-batch-downloader-gui/assets/84078595/24c68567-aaf5-4953-bda7-8fcec50e193c)

## Configuration

1. Connect your MyAnimeList account via authorization.
2. Select what you want to do with new anime or manga (e.g., add to plan-to-watch or plan-to-read).
3. Select custom quality.
4. Provider Options: Hianime & AnimePahe

- Hianime Subtitle Downloads: Hianime supports subtitle downloads, and users can select to download subtitles in a folder or merge them with video.

## Uninstalling the Application

### 💻 For Windows:

To delete the application, navigate to the following directory:

```
C:\Users\USERNAME\AppData\Local\Programs\StrawVerse
```

Then, run `Uninstall StrawVerse.exe`.

### 🐧 For Linux:

- **AppImage:** Simply delete the downloaded `.AppImage` file. If you want to clean up application configurations, delete the `~/.config/strawverse` directory.
- **Snap:** Run the following command in your terminal:
  ```bash
  sudo snap remove strawverse
  ```

---

# Build the Application

Follow these steps to build application:

## Prerequisites

1. **Download and install Node.js**:
   - [Node.js Download](https://nodejs.org/)

2. **Download and install Git**:
   - [Git Download](https://git-scm.com/)

3. **Download and install Python**
   - [Python Download](https://www.python.org/downloads/)

4. **C++ Build Tools (Windows only, required for compiling native SQLite node modules via node-gyp)**
   - During the Node.js installation on Windows, make sure you check the box that says **"Automatically install the necessary tools"** (this installs Python and the necessary VS Build Tools via Chocolatey automatically).
   - Alternatively, you can manually download and install **[Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)** (be sure to select the **Desktop development with C++** workload during setup).

## Steps to Build

1. Clone the repository:

   ```bash
   git clone https://github.com/TheYogMehta/StrawVerse.git
   ```

2. Navigate to the project directory:

   ```bash
   cd StrawVerse/src
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. For Building the application:

   ```bash
   npm run package
   ```

5. Run the application for testing:
   ```bash
   npm run start
   ```

## Notes

- Build (package): Creates installer/executable files for Windows (`.exe`) and Linux (`.AppImage`, `.snap`) in the `dist` directory.
- Start: Runs the app locally in the Electron environment without building an executable.
- Ensure that your system has the latest versions of Node.js and Git installed for compatibility.
- If you encounter any issues, feel free to open an issue or join our [Discord Server](https://discord.gg/PzfUBgQ2gt) for support and chat!
