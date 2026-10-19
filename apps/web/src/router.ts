import { createRouter, createWebHistory } from "vue-router";
const Login = () => import("./pages/Login.vue");
const MyWork = () => import("./pages/MyWork.vue");
const Projects = () => import("./pages/Projects.vue");
const Task = () => import("./pages/Task.vue");
const Requirement = () => import("./pages/Requirement.vue");
const Bug = () => import("./pages/Bug.vue");
const Reports = () => import("./pages/Reports.vue");
const Members = () => import("./pages/Members.vue");
const Activate = () => import("./pages/Activate.vue");
const Password = () => import("./pages/Password.vue");
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
