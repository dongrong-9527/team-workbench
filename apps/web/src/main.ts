import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
const app = createApp(App).use(router);
// Session checks must see the resolved initial route, including lazy public pages.
void router.isReady().then(() => app.mount("#app"));
