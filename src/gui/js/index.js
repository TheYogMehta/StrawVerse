let pagination = "off";
let currentPage = 1;
let isFetching = false;
let totalPages = null;
let allDataFetched = false;
let hasNextPage = true;
let api = null;
let infoapi = null;

let SiteFilters = {
  hianime: {
    type: {
      config: {
        select_type: 1,
      },
      options: {
        All: null,
        Movie: 1,
        Tv: 2,
        OVA: 3,
        ONA: 4,
        Special: 5,
        Music: 6,
      },
    },
    status: {
      config: {
        select_type: 1,
      },
      options: {
        All: null,
        "Finished Airing": 1,
        "Currently Airing": 2,
        "Not Yet Aired": 3,
      },
    },
    rated: {
      config: {
        select_type: 1,
      },
      options: {
        All: null,
        G: 1,
        PG: 2,
        "PG-13": 3,
        R: 4,
        "R+": 5,
        Rx: 6,
      },
    },
    score: {
      config: {
        select_type: 1,
      },
      options: {
        All: null,
        "(1) Appalling": 1,
        "(2) Horrible": 2,
        "(3) Very Bad": 3,
        "(4) Bad": 4,
        "(5) Average": 5,
        "(6) Fine": 6,
        "(7) Good": 7,
        "(8) Very Good": 8,
        "(9) Great": 9,
        "(10) Masterpiece": 10,
      },
    },
    season: {
      config: {
        select_type: 1,
      },
      options: {
        All: null,
        Spring: 1,
        Summer: 2,
        Fall: 3,
        Winter: 4,
      },
    },
    language: {
      config: {
        select_type: 1,
      },
      options: {
        All: null,
        SUB: 1,
        DUB: 2,
      },
    },
    sort: {
      config: {
        select_type: 1,
      },
      options: {
        "Recently Updated": "recently_updated",
        "Recently Added": "recently_added",
        Score: "score",
        "Name A-Z": "name_az",
        "released date": "released_date",
        "most watched": "most_watched",
      },
    },
  },
  animekai: {
    sort: {
      config: {
        select_type: 1,
      },
      options: {
        "Updated Date": "updated_date",
        "Released Date": "released_date",
        "End Date": "end_date",
        "Added Date": "added_date",
        Trending: "trending",
        "Name A-Z": "title_az",
        "Average Score": "avg_score",
        "MAL Score": "mal_score",
        "Total Views": "total_views",
        "Total Bookmarks": "total_bookmarks",
        "Total Episodes": "total_episodes",
      },
    },
    status: {
      config: {
        select_type: 2,
      },
      options: {
        "Not Yet Aired": "info",
        Releasing: "releasing",
        Completed: "completed",
      },
    },
    type: {
      config: {
        select_type: 2,
      },
      options: {
        Movie: "movie",
        Tv: "tv",
        OVA: "ova",
        ONA: "ona",
        Special: "special",
        Music: "music",
      },
    },
    season: {
      config: {
        select_type: 2,
      },
      options: {
        Fall: "fall",
        Summer: "summer",
        Spring: "spring",
        Winter: "winter",
        Unknown: "unknown",
      },
    },
    rating: {
      config: {
        select_type: 2,
      },
      options: {
        G: "g",
        PG: "pg",
        "PG 13": "pg_13",
        R: "r",
        "R+": "r+",
        RX: "rx",
      },
    },
    language: {
      config: {
        select_type: 2,
      },
      options: {
        "Soft Sub": "softsub",
        Sub: "sub",
        Dub: "dub",
        "Sub & Dub": "subdub",
      },
    },
  },
};

let Applied_Filters = {};

let Filter_Added = false;

async function fetchPageData(page, init = false) {
  try {
    if (isFetching || (page > 1 && !hasNextPage) || allDataFetched) return;
    isFetching = true;

    const response = await fetch(`${api}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filters: {
          ...Applied_Filters,
          page: page,
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to fetch data");
    }

    const data = await response.json();

    if (data?.extension_missing) {
      window.location.href = `/error?message=${encodeURIComponent(
        "Please Install Provider From Marketplace From 'Settings > Anime > MarketPlace' !"
      )}`;
    }

    currentPage = page;

    hasNextPage = data?.hasNextPage ?? false;

    if (data?.hasNextPage && init) {
      if (pagination === "on") {
        document.body.innerHTML += '<div id="pagination-controls"></div>';
      } else {
        window.addEventListener("scroll", handleScroll);
      }
    }

    if (pagination === "on") {
      addPaginationControls();
    }

    if (data && data.results && data.results.length > 0) {
      await addchild(data);

      if (data?.site && !Filter_Added) {
        Filter_Added = true;
        let SelectedFilters = SiteFilters[data?.site];

        if (SelectedFilters) {
          const AnimeFiltersDiv = document.getElementById("anime-filters");

          Object.entries(SelectedFilters).forEach(
            ([category, catagorie_data]) => {
              const wrapper = document.createElement("div");
              wrapper.className = "filter-group";

              const label = document.createElement("label");
              label.textContent =
                category.charAt(0).toUpperCase() + category.slice(1);
              wrapper.appendChild(label);

              const select = document.createElement("select");
              select.name = category;
              select.classList.add("slim-select");

              if (catagorie_data?.config?.select_type === 2) {
                select.multiple = true;
                select.dataset.placeholder = "Select multiple...";
              } else {
                select.dataset.placeholder = "Select one...";
              }

              Object.entries(catagorie_data?.options).forEach(
                ([label, value]) => {
                  const option = document.createElement("option");
                  option.value = value ?? "";
                  option.textContent = label;
                  select.appendChild(option);
                }
              );

              wrapper.appendChild(select);
              AnimeFiltersDiv.appendChild(wrapper);

              new SlimSelect({
                select: select,
                settings: {
                  placeholderText: select.dataset.placeholder,
                  closeOnSelect: !select.multiple,
                  showSearch: false,
                },
              });

              select.addEventListener("change", async (e) => {
                const selected = Array.from(e.target.selectedOptions).map(
                  (opt) => opt.value
                );

                if (!selected.length || selected.includes("")) {
                  delete Applied_Filters[category];
                } else {
                  Applied_Filters[category] =
                    catagorie_data?.config?.select_type === 2
                      ? selected
                      : selected[0];
                }

                isFetching = false;
                allDataFetched = false;
                hasNextPage = true;
                currentPage = 1;

                const animeGrid = document.getElementById("anime-grid");
                animeGrid.innerHTML = "";

                return await fetchPageData(currentPage);
              });
            }
          );
        }
      }
    } else {
      allDataFetched = true;
    }

    isFetching = false;
  } catch (err) {
    console.error("Error fetching data:", err);
    return null;
  }
}

async function addchild(data) {
  const animeGrid = document.getElementById("anime-grid");
  if (pagination === "on") {
    animeGrid.innerHTML = "";
  }
  if (data && data.results && data.results.length > 0) {
    data.results.forEach((result) => {
      const animeCard = document.createElement("div");
      animeCard.classList.add("anime-card");
      animeCard.innerHTML = `
          <a href="${infoapi}${encodeURIComponent(result.id)}">
            <div class="anime-item">
              <img 
                src="./images/loading-image.png"
                data-src="${result.image}" 
                alt="${result.title}" 
                onerror="this.onerror=null; this.src='./images/image-404.png';"
                class="thumbnail lazy-image" />
                ${
                  result?.totalEpisodes !== undefined &&
                  result?.totalEpisodes !== null &&
                  result?.DownloadedEpisodes !== undefined &&
                  result?.DownloadedEpisodes !== null
                    ? `<div class="episodes">
                        <div class="downloaded">
                          <div class="material-symbols-rounded">download_done</div> 
                          ${result?.DownloadedEpisodes?.length}
                        </div>
                        <div class="total">
                          <div class="material-symbols-rounded">download</div> 
                          ${result?.totalEpisodes}
                        </div>
                      </div>`
                    : result?.totalEpisodes !== undefined &&
                      result?.totalEpisodes !== null &&
                      result?.watched !== undefined &&
                      result?.watched !== null
                    ? `<div class="episodes">
                        <div class="downloaded">
                          <div class="material-symbols-rounded">visibility</div>
                          ${result.watched}
                        </div>
                        <div class="total">
                          <div class="material-symbols-rounded">movie</div>
                          ${result.totalEpisodes}
                        </div>
                      </div>`
                    : ""
                }
                ${
                  result?.NextEpisodeIn
                    ? `<div class="episodes-right">
                        <div>${formatRelativeTime(result.NextEpisodeIn)}</div>
                      </div>`
                    : ""
                }                
              <div class="overlay">${result.title}</div>
            </div>
          </a>
        `;
      animeGrid.appendChild(animeCard);
    });

    const lazyImages = document.querySelectorAll(".lazy-image");
    lazyImages.forEach((img) => {
      img.classList.remove("lazy-image");
      const tempImage = new Image();
      tempImage.src = img.getAttribute("data-src");

      tempImage.onload = function () {
        img.src = tempImage.src;
      };

      tempImage.onerror = function () {
        img.src = "./images/image404.png";
      };
    });
  }
}

function formatRelativeTime(timestamp) {
  const diff = timestamp - Date.now();

  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / (1000 * 60));
  const hours = Math.floor(absDiff / (1000 * 60 * 60));
  const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));

  if (absDiff < 60 * 1000) {
    return diff >= 0 ? `in a few secs` : `a few secs ago`;
  } else if (absDiff < 60 * 60 * 1000) {
    return diff >= 0
      ? `in ${minutes} min${minutes !== 1 ? "s" : ""}`
      : `${minutes} min${minutes !== 1 ? "s" : ""} ago`;
  } else if (absDiff < 24 * 60 * 60 * 1000) {
    return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
  } else {
    return diff >= 0 ? `in ${days}d` : `${days}d ago`;
  }
}

function addPaginationControls() {
  const paginationContainer = document.getElementById("pagination-controls");
  if (!paginationContainer) return;
  paginationContainer.innerHTML = "";
  if (!currentPage) return;

  const inputField = `<input type="number" id="pageInput" min="1" max="${
    totalPages || ""
  }" value="${currentPage}" class="pagination-btn page-number" style="width: 80px; text-align: center;" inputmode="numeric" pattern="[0-9]*">`;

  let firstButtons = "";
  let lastButtons = "";

  if (totalPages) {
    firstButtons = Array.from(
      { length: Math.min(4, totalPages) },
      (_, i) => i + 1
    )
      .map(
        (page) =>
          `<button class="pagination-btn page-number ${
            page === currentPage ? "active" : ""
          }" data-page="${page}" ${
            page === currentPage ? "disabled" : ""
          }>${page}</button>`
      )
      .join("");

    lastButtons =
      totalPages > 4
        ? Array.from({ length: 4 }, (_, i) => totalPages - 3 + i)
            .map(
              (page) =>
                `<button class="pagination-btn page-number ${
                  page === currentPage ? "active" : ""
                }" data-page="${page}" ${
                  page === currentPage ? "disabled" : ""
                }>${page}</button> `
            )
            .join("")
        : "";

    paginationContainer.innerHTML = `
  <div class="pagination-wrapper">
    ${firstButtons} <button class="pagination-btn page-number" id="prevPage">&lt;</button> ${inputField} <button class="pagination-btn page-number" id="nextPage">&gt;</button> ${lastButtons}
  </div>`;
  } else {
    paginationContainer.innerHTML = `
  <div class="pagination-wrapper">
    <button class="pagination-btn page-number ${
      currentPage <= 1 ? "active" : ""
    }" id="prevPage" ${currentPage <= 1 ? "disabled" : ""}>&lt;</button>
    ${inputField}
    <button class="pagination-btn page-number ${
      hasNextPage ? "" : "active"
    }" id="nextPage" ${hasNextPage ? "" : "disabled"}>&gt;</button>
  </div>`;
  }

  document
    .querySelectorAll("#pagination-controls button[data-page]")
    .forEach((btn) =>
      btn.addEventListener("click", (e) =>
        handlePagination(parseInt(e.target.dataset.page, 10))
      )
    );

  const pageInput = document.getElementById("pageInput");
  pageInput.addEventListener("change", (e) =>
    handlePagination(parseInt(e.target.value, 10))
  );

  if (currentPage > 1) {
    document
      .getElementById("prevPage")
      .addEventListener("click", () => handlePagination(currentPage - 1));
  } else {
    document.getElementById("prevPage").addEventListener("click", () =>
      Swal.fire({
        icon: "error",
        title: "Page Not Found",
        text: ":P Page you looking for doesn't exists ( like my gf )",
      })
    );
  }

  if (hasNextPage) {
    document
      .getElementById("nextPage")
      .addEventListener("click", () => handlePagination(currentPage + 1));
  } else {
    document.getElementById("nextPage").addEventListener("click", () =>
      Swal.fire({
        icon: "error",
        title: "Page Not Found",
        text: ":P Page you looking for doesn't exists ( like my gf )",
      })
    );
  }
}

async function handlePagination(targetPage) {
  targetPage = Math.max(1, parseInt(targetPage, 10));
  if (totalPages) targetPage = Math.min(totalPages, targetPage);
  if (targetPage !== currentPage) {
    await fetchPageData(targetPage);
  }
}

function isScrolledToBottom() {
  return window.innerHeight + window.scrollY >= document.body.offsetHeight - 500;
}

let scrollTimeout = null;
async function handleScroll() {
  if (scrollTimeout) return;
  scrollTimeout = setTimeout(async () => {
    scrollTimeout = null;
    if (!isFetching && isScrolledToBottom()) {
      await fetchPageData(currentPage + 1);
    }
  }, 100);
}

async function init(paginationInput, apiInput, infoapiInput) {
  pagination = paginationInput;
  api = apiInput;
  if (!api?.includes("/search?query=")) {
    Applied_Filters = {
      sort: "recently_updated",
    };
  }
  infoapi = infoapiInput;
  await fetchPageData(1, true);
  document.getElementById("loading-container").hidden = true;
}
