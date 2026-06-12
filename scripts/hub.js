// hub.js

import { auth } from "./firebase-config.js";
import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

onAuthStateChanged(auth, async (usuario) => {
    if (!usuario) { window.location.href = "index.html"; return; }
});
