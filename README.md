# Broken Atp. Development Restarts On 7th

<h6 align="right">💻 Support Windows Only For Now</h6>
<h1 align="center">
  <img src="https://capsule-render.vercel.app/api?type=soft&fontColor=703ee5&text=StrawVerse&height=150&fontSize=40&desc=Ridiculously%20efficient,%20fast%20and%20light-weight.&descAlignY=75&descAlign=50&color=00000000&animation=twinkling">
</h1>

## 💖 First Supporter

Special thanks to the first person who supported the development of this project:

| Name/Handle | Contribution | Link |
|-------------|--------------|------|
| maighe | $5 | [YouTube](https://www.youtube.com/@maighe_tv2848) |

Your contribution helps me improve, maintain, and update this project. Thank you!

Want to support? [Buy me a coffee](https://buymeacoffee.com/kowareta).


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

- **Operating System:** Windows (Support for other platforms coming soon)

## Installation

1. Go to [Anime-Manga Batch Downloader Releases](https://github.com/TheYogMehta/StrawVerse/releases)
2. Download `StrawVerse.exe`
3. Run it and enjoy

## Usage

1. Run `StrawVerse.exe`.
2. Search through the anime or manga list and download what you like.
3. See progress in downloads.
4. Anime episodes will be downloaded in the folder where you have stored `StrawVerse.exe`.
5. Manga chapters will be saved as cbz files in the designated folder.

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

To delete the application, navigate to the following directory:

```
C:\Users\USERNAME\AppData\Local\Programs\StrawVerse
```

Then, run `Uninstall StrawVerse.exe`.

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

4. **Windows Build Tools (Windows only, required for node-gyp)**
   ```bash
   npm install --global windows-build-tools
   ```

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

- Build: Creates an executable .exe file for Windows.
- Start: Runs the app locally in the Electron environment without building an executable.
- Ensure that your system has the latest versions of Node.js and Git installed for compatibility.
- If you encounter any issues open an issue.
