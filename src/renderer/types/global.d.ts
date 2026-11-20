import type { ThunderApi } from "../../preload/index";

declare global {
  interface Window {
    thunder: ThunderApi;
  }
}

export {};
