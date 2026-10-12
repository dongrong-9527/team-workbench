import { createRouter, createWebHistory } from "vue-router";
import Login from "./pages/Login.vue";
import MyWork from "./pages/MyWork.vue";
import Projects from "./pages/Projects.vue";
import Task from "./pages/Task.vue";
import Requirement from "./pages/Requirement.vue";
import Bug from "./pages/Bug.vue";
import Reports from "./pages/Reports.vue";
import Members from "./pages/Members.vue";
import Activate from "./pages/Activate.vue";
import Password from "./pages/Password.vue";
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/my-work" },
    { path: "/login", component: Login },
    { path: "/activate", component: Activate },
    { path: "/reset", component: Activate },
    { path: "/password", component: Password },
    { path: "/my-work", component: MyWork },
    { path: "/projects/:id?", component: Projects },
    { path: "/task/:id", component: Task },
    { path: "/requirement/:id", component: Requirement },
    { path: "/bug/:id", component: Bug },
    { path: "/reports", component: Reports },
    { path: "/members", component: Members },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
