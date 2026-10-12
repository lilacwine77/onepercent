import { TV_SIZES, tvSet } from "./tv-poster";
// The home's LCP image, the TV poster, downloads while the app's script runs,
// not after it renders: the script has the bandwidth first, then the poster
// (imported first in main.tsx; other routes never show it).
if (window.location.pathname === "/") {
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.type = "image/avif";
  link.setAttribute("imagesrcset", tvSet("avif"));
  link.setAttribute("imagesizes", TV_SIZES);
  link.setAttribute("fetchpriority", "high");
  document.head.append(link);
}
