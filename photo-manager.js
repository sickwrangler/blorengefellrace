(function () {
  "use strict";

  const page = document.body.dataset.photoPage;
  if (!page) return;

  function captionText(photo) {
    const parts = [];
    if (photo.caption) parts.push(photo.caption);
    if (photo.credit && photo.credit !== "Not recorded") parts.push(`Photo by ${photo.credit}`);
    return parts.join(" · ");
  }

  function applyPhoto(image, photo) {
    image.src = photo.optimizedFilename;
    image.alt = photo.alt;
    image.style.objectPosition = photo.objectPosition;
    image.dataset.photoId = photo.id;
  }

  function createFigure(photo) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.loading = "lazy";
    applyPhoto(image, photo);
    const content = photo.link ? document.createElement("a") : figure;
    if (photo.link) {
      content.href = photo.link;
      content.append(image);
      figure.append(content);
    } else {
      figure.append(image);
    }
    const text = captionText(photo);
    if (text) {
      const caption = document.createElement("figcaption");
      caption.textContent = text;
      figure.append(caption);
    }
    return figure;
  }

  fetch("data/photos/manifest.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Photo manifest returned ${response.status}`);
      return response.json();
    })
    .then((manifest) => {
      const photos = manifest.photos.filter((photo) => photo.page === page);
      const byId = new Map(photos.map((photo) => [photo.id, photo]));

      document.querySelectorAll("img[data-photo-id]").forEach((image) => {
        const photo = byId.get(image.dataset.photoId);
        if (!photo || !photo.active) {
          const container = image.closest("figure") ?? image;
          container.hidden = true;
          return;
        }
        applyPhoto(image, photo);
        const figure = image.closest("figure");
        if (!figure) return;
        const text = captionText(photo);
        let caption = figure.querySelector("figcaption");
        if (!text && caption) caption.remove();
        if (text && !caption) {
          caption = document.createElement("figcaption");
          figure.append(caption);
        }
        if (caption) caption.textContent = text;
      });

      document.querySelectorAll("[data-photo-region]").forEach((region) => {
        const selected = photos
          .filter((photo) => photo.active && photo.section === region.dataset.photoRegion)
          .sort((left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id));
        if (!selected.length) return;
        region.replaceChildren(...selected.map(createFigure));
      });
    })
    .catch(() => {
      // Existing HTML images remain as a resilient no-manifest fallback.
    });
}());
