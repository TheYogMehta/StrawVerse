window.sharedStateAPI.on("mal", (data) => {
  let LoggedIn = data?.LoggedIn;
  document.getElementById("connectMal").hidden = LoggedIn;
  document.getElementById("myAnimeList-logout").hidden = !LoggedIn;
  document.getElementById("myAnimeList-config").hidden = !LoggedIn;
});

window.sharedStateAPI.on("extention-updated", (data) => {
  // Anime Provider
  if (data?.Anime.length > 0) {
    document.getElementById("anime-provider").innerHTML = data?.Anime.map(
      (name) => `<option value="${name.name}">${name.name}</option>`
    ).join("");
  } else {
    document.getElementById("anime-provider").innerHTML = ``;
  }

  // Manga Provider
  if (data?.Manga.length > 0) {
    document.getElementById("manga-provider").innerHTML = data?.Manga.map(
      (name) => `<option value="${name.name}">${name.name}</option>`
    ).join("");
  } else {
    document.getElementById("manga-provider").innerHTML = ``;
  }
});

function showSection(targetId) {
  document.querySelectorAll(".settings-section").forEach((section) => {
    section.style.display = section.id === targetId ? "block" : "none";
  });
}

function showLoadingAnimation() {
  document.getElementById("overlay").style.display = "block";
}

function hideLoadingAnimation() {
  document.getElementById("overlay").style.display = "none";
}

function submitSettings(event) {
  event.preventDefault();
  const statusElement = document.getElementById("malstatus");
  const autotrackElement = document.getElementById("malautotrack");

  const data = {
    quality: document.getElementById("quality-select")?.value || null,
    Animeprovider: document.getElementById("anime-provider")?.value || null,
    Mangaprovider: document.getElementById("manga-provider")?.value || null,
    CustomDownloadLocation:
      document.getElementById("download-location")?.value || null,
    Pagination: document.getElementById("pagination")?.value || null,
    autoLoadNextChapter:
      document.getElementById("auto-load-next-chapter-select")?.value || null,
    autotrack: autotrackElement ? autotrackElement.value : null,
    status: statusElement ? statusElement.value : null,
    enableDiscordRPC:
      document.getElementById("discord-rpc-status-select")?.value || null,
  };

  document.getElementById("save-settings").style.display = "none";

  showLoadingAnimation();

  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
    .then((response) => response.json())
    .then((responseData) => {
      hideLoadingAnimation();
      if (responseData.message) {
        Swal.fire({
          icon: "success",
          title: "Updated Config",
          html: `<pre>${responseData.message}</pre>`,
        });
      } else {
        Swal.fire({
          icon: "error",
          title: "Opps Error :P",
          text: `${responseData.error}`,
        });
      }
    })
    .catch((error) => {
      hideLoadingAnimation();
      console.error("Error:", error);
      Swal.fire({
        icon: "error",
        title: "Failed To Update Config",
        text: "Something Went Wrong",
      });
    });
}

function redirectToUrl(url) {
  window.location.href = url;
}

function MalLogout() {
  fetch("./mal/logout");
}

function init(url, settings) {
  // Mal Connected Or Not
  let UrlPresent = url && url?.length > 0 ? true : false;
  document.getElementById("connectMal").hidden = !UrlPresent;
  document.getElementById("myAnimeList-logout").hidden = UrlPresent;
  document.getElementById("myAnimeList-config").hidden = UrlPresent;

  // Mal Status
  document.getElementById("malstatus").value =
    settings?.status ?? "plan_to_watch";

  // Mal Autotracking On / Off
  document.getElementById("malautotrack").value =
    settings?.malautotrack ?? "off";

  // Anime Provider
  if (settings?.providers?.Anime.length > 0) {
    document.getElementById("anime-provider").innerHTML =
      settings?.providers?.Anime.map(
        (name) => `<option value="${name}">${name}</option>`
      ).join("");
  }

  document.getElementById("anime-provider").value =
    settings?.Animeprovider ?? null;

  // Anime Quality
  document.getElementById("quality-select").value =
    settings?.quality ?? "1080p";

  // Manga Provider
  if (settings?.providers?.Manga.length > 0) {
    document.getElementById("manga-provider").innerHTML =
      settings?.providers?.Manga.map(
        (name) => `<option value="${name}">${name}</option>`
      ).join("");
  }

  document.getElementById("manga-provider").value =
    settings?.Mangaprovider ?? null;

  // Manga AutoLoad Next Chapter
  document.getElementById("auto-load-next-chapter-select").value =
    settings?.autoLoadNextChapter ?? "on";

  // pagination
  document.getElementById("pagination").value = settings?.pagination ?? "on";

  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener(
      "input",
      () => (document.getElementById("save-settings").style.display = "block")
    );
  });

  showSection("utils");
}
