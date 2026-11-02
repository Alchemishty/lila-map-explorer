import { startApp } from "./ui/app";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (appRoot === null) {
  throw new Error('index.html has no element with id "app" to mount the map explorer into');
}
// Data sits next to the built site, so the URL follows Vite's base ("./").
void startApp(appRoot, `${import.meta.env.BASE_URL}data/`);
