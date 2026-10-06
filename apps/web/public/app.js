import { navTo, render, sessionExpired } from "./js/router.js";

window.addEventListener("popstate",render);
window.addEventListener("royaltyos:session-expired",sessionExpired);

document.addEventListener("click",e=>{const a=e.target.closest("a[data-nav]");if(a){e.preventDefault();navTo(a.getAttribute("href"))}});

render();
