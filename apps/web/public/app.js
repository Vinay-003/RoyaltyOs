import { navTo, render } from "./js/router.js";

window.addEventListener("popstate",render);

document.addEventListener("click",e=>{const a=e.target.closest("a[data-nav]");if(a){e.preventDefault();navTo(a.getAttribute("href"))}});

render();
