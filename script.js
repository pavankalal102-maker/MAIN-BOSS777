import { 
    ref, 
    set, 
    get, 
    onValue, 
    runTransaction, 
    push, 
    query, 
    update,
    orderByChild, 
    equalTo 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";
import { db } from "./firebase.js";

let currentUserMobile = null;
let currentGeneratedPanas = []; // Holds motor combinations

// --- HELPER 1: TIME CHECK (AUTOMATIC OPEN/CLOSED) ---
// --- HELPER 1: ADVANCED TIME & SESSION CHECK ---
function getMarketSessionStatus(openTimeStr, closeTimeStr) {
    if (!openTimeStr || !closeTimeStr) return { isOpen: false, canPlayOpen: false, canPlayClose: false };
    
    try {
        const now = new Date();

        const parseTimeToDate = (timeStr) => {
            const parts = timeStr.trim().split(" ");
            if (parts.length < 2) return null;
            const [time, modifier] = parts;
            let [hours, minutes] = time.split(":").map(Number);

            if (modifier.toUpperCase() === "PM" && hours < 12) hours += 12;
            if (modifier.toUpperCase() === "AM" && hours === 12) hours = 0;

            const d = new Date();
            d.setHours(hours, minutes, 0, 0);
            return d;
        };

        let openTime = parseTimeToDate(openTimeStr);
        let closeTime = parseTimeToDate(closeTimeStr);

        if (!openTime || !closeTime) return { isOpen: false, canPlayOpen: false, canPlayClose: false };

        // Handle overnight timings (e.g. Open 10:00 PM, Close 02:00 AM)
        if (closeTime <= openTime) {
            closeTime.setDate(closeTime.getDate() + 1);
        }

        // 1. Agar Open Time se pehle ka time hai -> OPEN aur CLOSE dono sessions me play ho sakta hai
        const canPlayOpen = now < openTime;
        
        // 2. Agar Close Time se pehle ka time hai -> CLOSE session me play ho sakta hai
        const canPlayClose = now < closeTime;

        // 3. Overall Market Open hai agar Close Time abhi nahi hua hai
        const isOpen = canPlayClose;

        return { isOpen, canPlayOpen, canPlayClose };

    } catch (e) {
        console.error("Time Parsing Error:", e);
        return { isOpen: false, canPlayOpen: false, canPlayClose: false };
    }
}

// 2. REALTIME MARKETS LISTENER
function listenToMarkets() {
    const marketsRef = ref(db, "markets");
    const marketsList = document.getElementById("marketsList");
    if (!marketsList) return;

    onValue(marketsRef, (snapshot) => {
        marketsList.innerHTML = "";
        if (!snapshot.exists()) {
            marketsList.innerHTML = "<p style='text-align:center; padding:20px;'>No active markets found.</p>";
            return;
        }

        snapshot.forEach((childSnap) => {
            const marketId = childSnap.key;
            const market = childSnap.val();

            const sessionStatus = getMarketSessionStatus(market.openTime, market.closeTime);
            const isOpen = market.status === "OPEN" && sessionStatus.isOpen;

            const card = document.createElement("div");
            card.className = "market-card";

            const safeName = (market.name || "Market").replace(/'/g, "\\'");

            card.innerHTML = `
                <div class="market-info">
                    <h4>${market.name || 'Market'}</h4>
                    <div class="result">${market.result || "***-**-***"}</div>
                    <div class="time">Open: ${market.openTime || '--'} | Close: ${market.closeTime || '--'}</div>
                </div>
                <div class="market-status">
                    <span class="status-badge ${isOpen ? 'status-open' : 'status-closed'}">
                        ${isOpen ? 'OPEN' : 'CLOSED'}
                    </span>
                    <br>
                    <button class="play-btn" ${!isOpen ? 'disabled' : ''} onclick="openBidPopup('${marketId}', '${safeName}', '${market.openTime}', '${market.closeTime}')">
                        ${isOpen ? 'PLAY NOW' : 'CLOSED'}
                    </button>
                </div>
            `;
            marketsList.appendChild(card);
        });
    });
}

// --- AUTO-RESET MARKET RESULTS AT / AFTER 2:00 AM ---
async function checkAndResetMarketResults() {
    try {
        const resetRef = ref(db, "system/lastResetDate");
        const snapshot = await get(resetRef);
        
        const now = new Date();
        const todayDateStr = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        const currentHour = now.getHours(); // 0 to 23

        let lastResetDate = snapshot.exists() ? snapshot.val() : "";

        // Conditions for Reset:
        // 1. Aaj ka reset abhi tak nahi hua hai (lastResetDate !== todayDateStr)
        // 2. Current time raat 2 baje ya uske baad ka hai (currentHour >= 2)
        if (lastResetDate !== todayDateStr && currentHour >= 2) {
            console.log("⏰ Resetting all market results for the new day...");

            const marketsSnap = await get(ref(db, "markets"));
            if (marketsSnap.exists()) {
                const updates = {};
                
                // Sabhi markets ka result reset payload
                marketsSnap.forEach((child) => {
                    updates[`markets/${child.key}/result`] = "***-**-***";
                });

                // System last reset date update
                updates["system/lastResetDate"] = todayDateStr;

                // Single atomic write to Firebase
                await update(ref(db), updates);
                console.log("✅ All market results reset to ***-**-*** successfully!");
            }
        }
    } catch (error) {
        console.error("Error during auto-reset check:", error);
    }
}

// Call this function when markets list loads
document.addEventListener("DOMContentLoaded", () => {
    checkAndResetMarketResults();
});

// 3. BID POPUP OPEN WITH DYNAMIC SESSION FILTERING


// --- HELPER 2: SP & DP MOTOR GENERATOR (0 treated as 10 - Last Position) ---
function generateMotorPanas(digits, type) {
    let uniqueDigits = Array.from(new Set(digits.split("")));
    
    // Matka order sort: 1,2,3,4,5,6,7,8,9 pehle, '0' sabse last
    uniqueDigits.sort((a, b) => {
        if (a === "0") return 1;
        if (b === "0") return -1;
        return a - b;
    });

    let panas = [];

    if (type === "SP_MOTOR") {
        // Single Pana: 3 Distinct Digits
        for (let i = 0; i < uniqueDigits.length; i++) {
            for (let j = i + 1; j < uniqueDigits.length; j++) {
                for (let k = j + 1; k < uniqueDigits.length; k++) {
                    panas.push(`${uniqueDigits[i]}${uniqueDigits[j]}${uniqueDigits[k]}`);
                }
            }
        }
    } else if (type === "DP_MOTOR") {
        // Double Pana: 2 Same Digits + 1 Distinct Digit
        for (let i = 0; i < uniqueDigits.length; i++) {
            for (let j = 0; j < uniqueDigits.length; j++) {
                if (i !== j) {
                    let rawPana = [uniqueDigits[i], uniqueDigits[i], uniqueDigits[j]];
                    rawPana.sort((a, b) => {
                        if (a === "0") return 1;
                        if (b === "0") return -1;
                        return a - b;
                    });
                    let panaStr = rawPana.join("");
                    if (!panas.includes(panaStr)) panas.push(panaStr);
                }
            }
        }
    }
    return panas;
}

// 1. PAGE LOAD & SPLASH
window.addEventListener("DOMContentLoaded", () => {
    // Correct Mobile Number retrieval logic
    let savedMobile = localStorage.getItem("mobile") || localStorage.getItem("userMobile") || "";

    // Agar userMobile me text "loginMobileNumber" save ho gaya hai to usko fix karo
    if (savedMobile === "loginMobileNumber") {
        savedMobile = localStorage.getItem("mobile") || "";
    }

    if (savedMobile && savedMobile !== "loginMobileNumber") {
        let mobElem = document.getElementById("mobile");
        if (mobElem) mobElem.value = savedMobile;

        // Forcefully set valid mobile number in both keys
        localStorage.setItem("userMobile", savedMobile);
        localStorage.setItem("mobile", savedMobile);

        // Safely trigger Admin option
        if (typeof window.checkAndShowAdminOption === "function") {
            window.checkAndShowAdminOption(savedMobile);
        }
    } else {
        console.warn("Valid Mobile Number Not Found!");
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const ratesBtn = document.getElementById("gameRatesBtn");
    const ratesScreen = document.getElementById("gameRatesScreen");
    const backBtn = document.getElementById("closeGameRatesScreen");

    if (ratesBtn && ratesScreen) {
        ratesBtn.onclick = (e) => {
            e.preventDefault();
            ratesScreen.style.display = "flex";
        };
    }

    if (backBtn && ratesScreen) {
        backBtn.onclick = () => {
            ratesScreen.style.display = "none";
        };
    }
});

// Inline onclick Fallback
window.openGameRatesModal = function() {
    const ratesScreen = document.getElementById("gameRatesScreen");
    if (ratesScreen) ratesScreen.style.display = "flex";
};



setTimeout(() => {
    let splash = document.getElementById("splash");
    if (splash) splash.style.display = "none";

    let savedMobile = localStorage.getItem("mobile");
    if (savedMobile) {
        attemptAutoLogin(savedMobile);
    } else {
        let login = document.getElementById("login");
        if (login) login.style.display = "block";
    }
}, 1500);

// 2. REALTIME MARKETS LISTENER WITH AUTO TIME LOCK


// 3. BID POPUP INTERACTION & DYNAMIC CALCULATIONS

let pendingBidsList = [];
let matkaCurrentPanas = [];

// Open Bid Popup Handler
window.openBidPopup = function (marketId, marketName, openTimeStr, closeTimeStr) {
    const titleElem = document.getElementById("bidMarketTitle");
    if (titleElem) {
        titleElem.innerText = marketName;
        titleElem.dataset.marketId = marketId;
        titleElem.dataset.marketName = marketName;
        titleElem.dataset.openTime = openTimeStr;
        titleElem.dataset.closeTime = closeTimeStr;
    }

    const sessionStatus = getMarketSessionStatus(openTimeStr, closeTimeStr);
    const sessionSelect = document.getElementById("bidSession");

    if (sessionSelect) {
        sessionSelect.innerHTML = "";
        if (sessionStatus.canPlayOpen) {
            const openOpt = document.createElement("option");
            openOpt.value = "OPEN";
            openOpt.innerText = "OPEN";
            sessionSelect.appendChild(openOpt);
        }
        if (sessionStatus.canPlayClose) {
            const closeOpt = document.createElement("option");
            closeOpt.value = "CLOSE";
            closeOpt.innerText = "CLOSE";
            sessionSelect.appendChild(closeOpt);
        }
    }

    resetBidFormCompletely();
    const popup = document.getElementById("bidPopup");
    if (popup) {
        popup.style.setProperty("display", "flex", "important");
    }
};

// Game Card Click Handler - Show Bidding View & Hide Game Cards View
document.querySelectorAll(".matka-game-card").forEach(card => {
    card.addEventListener("click", function() {
        const selectedGame = this.dataset.game;
        const hiddenSelect = document.getElementById("gameType");
        if (hiddenSelect) {
            hiddenSelect.value = selectedGame;
            updateInputRules();
        }
        
        // Hide Game Cards & Show Form
        const gamesView = document.getElementById("matkaGamesView");
        const biddingView = document.getElementById("matkaBiddingView");
        
        if (gamesView) gamesView.style.setProperty("display", "none", "important");
        if (biddingView) biddingView.style.setProperty("display", "flex", "important");
    });
});

// Dynamic Input Restrictions
function updateInputRules() {
    const gameTypeSelect = document.getElementById("gameType");
    const bidNumberInput = document.getElementById("bidNumber");
    const inputLabel = document.getElementById("inputLabel");
    const previewBox = document.getElementById("combinationsPreview");

    if (!gameTypeSelect || !bidNumberInput) return;
    const type = gameTypeSelect.value;
    
    bidNumberInput.value = "";
    matkaCurrentPanas = [];
    if (previewBox) previewBox.style.display = "none";

    if (inputLabel) {
        if (type === "SINGLE_DIGIT") {
            inputLabel.innerText = "ENTER SINGLE DIGIT :";
            bidNumberInput.maxLength = 1;
        } else if (type === "JODI") {
            inputLabel.innerText = "ENTER JODI NUMBER :";
            bidNumberInput.maxLength = 2;
        } else if (type === "SP_MOTOR" || type === "DP_MOTOR") {
            inputLabel.innerText = "ENTER MOTOR DIGITS :";
            bidNumberInput.maxLength = 10;
        } else if (type === "SINGLE_PANA") {
            inputLabel.innerText = "ENTER SINGLE PANA :";
            bidNumberInput.maxLength = 3;
        } else if (type === "DOUBLE_PANA") {
            inputLabel.innerText = "ENTER DOUBLE PANA :";
            bidNumberInput.maxLength = 3;
        } else if (type === "TRIPLE_PANA") {
            inputLabel.innerText = "ENTER TRIPLE PANA :";
            bidNumberInput.maxLength = 3;
        } else if (type === "CYCLE_PANA") {
            inputLabel.innerText = "ENTER CYCLE DIGITS :";
            bidNumberInput.maxLength = 2;
        }
    }
}

// Single Pana Check: Teeno digits alag honi chahiye (e.g. 123, 345)
function isSinglePana(pana) {
    if (pana.length !== 3 || isNaN(pana)) return false;
    return (pana[0] !== pana[1]) && (pana[1] !== pana[2]) && (pana[0] !== pana[2]);
}

// Double Pana Check: Koi 2 digits same aur 1 alag honi chahiye (e.g. 223, 556)
function isDoublePana(pana) {
    if (pana.length !== 3 || isNaN(pana)) return false;
    const d1 = pana[0], d2 = pana[1], d3 = pana[2];
    return (d1 === d2 && d1 !== d3) || (d2 === d3 && d2 !== d1) || (d1 === d3 && d1 !== d2);
}

// Triple Pana Check: Teeno digits same honi chahiye (e.g. 111, 555)
function isTriplePana(pana) {
    if (pana.length !== 3 || isNaN(pana)) return false;
    return (pana[0] === pana[1]) && (pana[1] === pana[2]);
}

// Cycle Pana Generator: 2 digit se 10 Valid Pattiyan Generate karega
function generateCyclePana(twoDigits) {
    if (twoDigits.length !== 2 || isNaN(twoDigits)) return [];
    
    const d1 = parseInt(twoDigits[0]);
    const d2 = parseInt(twoDigits[1]);
    const cyclePanas = [];

    for (let i = 0; i <= 9; i++) {
        let arr = [d1, d2, i];
        
        // Matka Rules: '0' hamesha last me aayega (e.g. 1-2-0 -> 120)
        arr.sort((a, b) => {
            if (a === 0) return 1;
            if (b === 0) return -1;
            return a - b;
        });

        let panaStr = arr.join("");
        if (!cyclePanas.includes(panaStr)) {
            cyclePanas.push(panaStr);
        }
    }
    return cyclePanas;
}

// Live Combination Generator & Input Event
document.getElementById("bidNumber")?.addEventListener("input", function () {
    const type = document.getElementById("gameType").value;
    this.value = this.value.replace(/[^0-9]/g, "");
    const previewBox = document.getElementById("combinationsPreview");

    if (type === "SP_MOTOR" || type === "DP_MOTOR") {
        if (this.value.length >= 3) {
            matkaCurrentPanas = generateMotorPanas(this.value, type);
            if (previewBox) {
                previewBox.style.display = "block";
                previewBox.innerHTML = `<b>Total Panas (${matkaCurrentPanas.length}):</b> ${matkaCurrentPanas.join(", ")}`;
            }
        } else {
            if (previewBox) previewBox.style.display = "none";
            matkaCurrentPanas = [];
        }
    } else {
        if (previewBox) previewBox.style.display = "none";
        matkaCurrentPanas = this.value ? [this.value] : [];
    }
});

// ADD MORE BUTTON
document.getElementById("matkaAddMoreBtn")?.addEventListener("click", function() {
    const bidMsg = document.getElementById("bidMessage");
    if (bidMsg) bidMsg.innerText = "";

    const session = document.getElementById("bidSession")?.value;
    const gameType = document.getElementById("gameType")?.value;
    const inputVal = document.getElementById("bidNumber")?.value.trim();
    const points = parseInt(document.getElementById("bidPoints")?.value);

    // 1. Single Digit Validation
    if (gameType === "SINGLE_DIGIT" && inputVal.length !== 1) {
        if (bidMsg) bidMsg.innerText = "Please enter 1 digit (0-9)"; return;
    }

    // 2. Jodi Validation
    if (gameType === "JODI" && inputVal.length !== 2) {
        if (bidMsg) bidMsg.innerText = "Please enter 2 digits (00-99)"; return;
    }

    // 3. Single Pana Validation (Only Unique 3 Digits e.g. 123)
    if (gameType === "SINGLE_PANA" && !isSinglePana(inputVal)) {
        if (bidMsg) bidMsg.innerText = "Invalid Single Pana! All 3 digits must be different (e.g. 123)"; return;
    }

    // 4. Double Pana Validation (e.g. 223)
    if (gameType === "DOUBLE_PANA" && !isDoublePana(inputVal)) {
        if (bidMsg) bidMsg.innerText = "Invalid Double Pana! Must contain 2 same digits (e.g. 223)"; return;
    }

    // 5. Triple Pana Validation (e.g. 555)
    if (gameType === "TRIPLE_PANA" && !isTriplePana(inputVal)) {
        if (bidMsg) bidMsg.innerText = "Invalid Triple Pana! All 3 digits must be same (e.g. 555)"; return;
    }

    // 6. Cycle Pana Validation (2 Digits e.g. 23)
    if (gameType === "CYCLE_PANA" && inputVal.length !== 2) {
        if (bidMsg) bidMsg.innerText = "Please enter 2 digits for Cycle Pana (e.g. 23)"; return;
    }

    // 7. SP / DP Motor Validation
    if ((gameType === "SP_MOTOR" || gameType === "DP_MOTOR") && matkaCurrentPanas.length === 0) {
        if (bidMsg) bidMsg.innerText = "Enter at least 3 digits to form Motor Panas!"; return;
    }

    // 8. Points Validation
    if (isNaN(points) || points <= 0) {
        if (bidMsg) bidMsg.innerText = "Enter valid points!"; return;
    }

    // --- Items Array Construction ---
    let itemsToAdd = [];

    if (gameType === "SP_MOTOR" || gameType === "DP_MOTOR") {
        itemsToAdd = matkaCurrentPanas;
    } else if (gameType === "CYCLE_PANA") {
        // Generates 10 Patti Array
        itemsToAdd = generateCyclePana(inputVal); 
    } else {
        itemsToAdd = [inputVal];
    }

    // Push Bids to Pending List
    itemsToAdd.forEach(panaNum => {
        pendingBidsList.push({
            session: session,
            gameType: gameType,
            number: panaNum,
            points: points
        });
    });

    renderPendingBidsTable();

    // Reset Form
    document.getElementById("bidNumber").value = "";
    document.getElementById("bidPoints").value = "";
    if (document.getElementById("combinationsPreview")) {
        document.getElementById("combinationsPreview").style.display = "none";
    }
    matkaCurrentPanas = [];
});

// Render Table Function
function renderPendingBidsTable() {
    const tableSection = document.getElementById("matkaTableSection");
    const tableBody = document.getElementById("matkaTableBody");
    const footer = document.getElementById("matkaSubmitFooter");

    tableBody.innerHTML = "";

    if (pendingBidsList.length === 0) {
        tableSection.style.display = "none";
        footer.style.setProperty("display", "none", "important");
        return;
    }

    tableSection.style.display = "block";
    footer.style.setProperty("display", "flex", "important");

    let totalPts = 0;
    pendingBidsList.forEach((item, index) => {
        totalPts += item.points;
        const row = document.createElement("div");
        row.className = "matka-table-row";
        row.innerHTML = `
            <span><b>${item.number}</b></span>
            <span>${item.points}</span>
            <span>${item.gameType}</span>
            <button type="button" class="matka-del-btn" onclick="removePendingBidItem(${index})" title="Delete">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
</button>
        `;
        tableBody.appendChild(row);
    });

    document.getElementById("matkaTotalBidsCount").innerText = pendingBidsList.length;
    document.getElementById("totalPointsDisplay").innerText = `${totalPts}`;
}

window.removePendingBidItem = function(index) {
    pendingBidsList.splice(index, 1);
    renderPendingBidsTable();
};

// SUBMIT BIDS
document.getElementById("submitBidBtn")?.addEventListener("click", async () => {
    if (pendingBidsList.length === 0) return;

    const titleElem = document.getElementById("bidMarketTitle");
    const marketId = titleElem?.dataset.marketId;
    const marketName = titleElem?.dataset.marketName;
    const openTimeStr = titleElem?.dataset.openTime;
    const closeTimeStr = titleElem?.dataset.closeTime;
    const bidMsg = document.getElementById("bidMessage");

    const currentSessionStatus = getMarketSessionStatus(openTimeStr, closeTimeStr);
    const hasOpenBid = pendingBidsList.some(b => b.session === "OPEN");
    const hasCloseBid = pendingBidsList.some(b => b.session === "CLOSE");

    if (hasOpenBid && !currentSessionStatus.canPlayOpen) {
        if (bidMsg) bidMsg.innerText = "❌ Open session timing is already closed!"; return;
    }
    if (hasCloseBid && !currentSessionStatus.canPlayClose) {
        if (bidMsg) bidMsg.innerText = "❌ Market timing is completely closed!"; return;
    }

    const totalAmountRequired = pendingBidsList.reduce((sum, item) => sum + item.points, 0);

    if (bidMsg) bidMsg.innerText = "Processing Bid...";

    const walletRef = ref(db, `users/${currentUserMobile}/wallet`);

    try {
        const result = await runTransaction(walletRef, (currentWallet) => {
            if (currentWallet === null) return 0;
            if (currentWallet < totalAmountRequired) {
                return;
            }
            return currentWallet - totalAmountRequired;
        });

        if (!result.committed) {
            if (bidMsg) bidMsg.innerText = "❌ Insufficient Wallet Balance!";
            return;
        }
        

// Current date string (YYYY-MM-DD)
const todayGameDate = new Date().toISOString().split('T')[0];

const bidsPromises = pendingBidsList.map((bidItem) => {
    const newBidRef = push(ref(db, "bids"));
    return set(newBidRef, {
        userMobile: currentUserMobile,
        marketId: marketId,
        marketName: marketName || marketId,
        session: bidItem.session,
        gameType: bidItem.gameType,
        bidNumber: bidItem.number,
        points: bidItem.points,
        status: "PENDING",
        gameDate: todayGameDate, // <-- NEW FIELD ADDED
        timestamp: Date.now()
    });
});

        await Promise.all(bidsPromises);

        document.getElementById("matkaSuccessDetails").innerText = `Bids: ${pendingBidsList.length} | Total Points: ${totalAmountRequired}`;
        const popupOverlay = document.getElementById("matkaSuccessPopup");
        if (popupOverlay) popupOverlay.style.setProperty("display", "flex", "important");

    } catch (error) {
        console.error("Bid Error:", error);
        if (bidMsg) bidMsg.innerText = "Transaction Error. Check Database Rules.";
    }
});

// Close Success Popup
document.getElementById("matkaCloseSuccessBtn")?.addEventListener("click", function() {
    const popupOverlay = document.getElementById("matkaSuccessPopup");
    if (popupOverlay) popupOverlay.style.setProperty("display", "none", "important");
    
    document.getElementById("bidPopup").style.setProperty("display", "none", "important");
    resetBidFormCompletely();
});

// Header Back Button
document.getElementById("closeBidBtn")?.addEventListener("click", () => {
    const biddingView = document.getElementById("matkaBiddingView");
    if (biddingView && biddingView.style.display !== "none") {
        biddingView.style.setProperty("display", "none", "important");
        document.getElementById("matkaGamesView").style.setProperty("display", "block", "important");
    } else {
        document.getElementById("bidPopup").style.setProperty("display", "none", "important");
        resetBidFormCompletely();
    }
});

function resetBidFormCompletely() {
    pendingBidsList = [];
    matkaCurrentPanas = [];
    document.getElementById("bidNumber").value = "";
    document.getElementById("bidPoints").value = "";
    document.getElementById("bidMessage").innerText = "";
    document.getElementById("combinationsPreview").style.display = "none";
    
    document.getElementById("matkaGamesView").style.setProperty("display", "block", "important");
    document.getElementById("matkaBiddingView").style.setProperty("display", "none", "important");
    document.getElementById("matkaSubmitFooter").style.setProperty("display", "none", "important");
    
    renderPendingBidsTable();
}


// 4. SUBMIT BID LOGIC


// --- SESSION & AUTH CODE ---
function loadUserSession(mobile, name) {
    currentUserMobile = mobile;
    let pm = document.getElementById("profileMobile");
    let pn = document.getElementById("profileName");
    if (pm) pm.value = mobile;
    if (pn) pn.value = name || "";

    const loginBox = document.getElementById("login");
    const homeBox = document.getElementById("home");
    if (loginBox) loginBox.style.display = "none";
    if (homeBox) homeBox.style.display = "block";

    onValue(ref(db, `users/${mobile}/wallet`), (snapshot) => {
        const points = snapshot.val() || 0;
        const walletElem = document.getElementById("wallet");
        if (walletElem) walletElem.innerText = points;
    });

    listenToMarkets();
}

async function attemptAutoLogin(mobile) {
    try {
        const snapshot = await get(ref(db, `users/${mobile}`));
        if (snapshot.exists()) {
            loadUserSession(mobile, snapshot.val().name);
        } else {
            const loginBox = document.getElementById("login");
            if (loginBox) loginBox.style.display = "block";
        }
    } catch (error) {
        const loginBox = document.getElementById("login");
        if (loginBox) loginBox.style.display = "block";
    }
}

document.getElementById("loginBtn")?.addEventListener("click", async () => {
    let mobile = document.getElementById("mobile")?.value.trim();
    let password = document.getElementById("password")?.value.trim();
    const msg = document.getElementById("loginMessage");

    if (!mobile || mobile.length !== 10) { if (msg) msg.innerText = "Enter valid mobile"; return; }
    if (!password) { if (msg) msg.innerText = "Enter password"; return; }

    try {
        const snapshot = await get(ref(db, `users/${mobile}`));
        if (!snapshot.exists() || snapshot.val().password !== password) {
            if (msg) msg.innerText = "Invalid Mobile or Password!";
            return;
        }
        localStorage.setItem("mobile", mobile);
        loadUserSession(mobile, snapshot.val().name);
    } catch (error) {
        if (msg) msg.innerText = "Login failed.";
    }
});

document.getElementById("logoutBtn")?.addEventListener("click", () => {
    localStorage.removeItem("mobile");
    currentUserMobile = null;
    const homeBox = document.getElementById("home");
    const loginBox = document.getElementById("login");
    if (homeBox) homeBox.style.display = "none";
    if (loginBox) loginBox.style.display = "block";
});

// --- SIDE MENU & POPUPS LISTENERS ---
// --- FAST & SMOOTH SIDE MENU LOGIC ---

// Fast Open Menu
// Menu Open + Realtime Name & Phone Fetch
document.getElementById("menuBtn")?.addEventListener("click", () => {
    document.getElementById("sideMenu")?.classList.add("active");
    document.getElementById("sideMenuOverlay")?.classList.add("active");

    const phoneElem = document.getElementById("menuUserPhone");
    const nameElem = document.getElementById("menuUserName");

    // 1. Phone Set
    const userPhone = currentUserMobile || localStorage.getItem("userMobile") || "Guest";
    if (phoneElem) phoneElem.innerText = userPhone;

    // 2. Name Set (First check LocalStorage, then Firebase)
    const localName = localStorage.getItem("userName");
    if (localName && nameElem) {
        nameElem.innerText = localName;
    }

    // Firebase Se Realtime Name Fetch
    if (userPhone && userPhone !== "Guest") {
        get(ref(db, `users/${userPhone}/name`)).then((snapshot) => {
            if (snapshot.exists() && snapshot.val()) {
                const fetchedName = snapshot.val();
                if (nameElem) nameElem.innerText = fetchedName;
                localStorage.setItem("userName", fetchedName); // Cache for next time
            } else if (!localName && nameElem) {
                nameElem.innerText = "User Name";
            }
        }).catch(() => {
            if (!localName && nameElem) nameElem.innerText = "User Name";
        });
    }
});

// Helper Function: Close Side Menu Instant
function closeSideMenu() {
    document.getElementById("sideMenu")?.classList.remove("active");
    document.getElementById("sideMenuOverlay")?.classList.remove("active");
}

// Click Outside (Overlay) to Close Side Menu
document.getElementById("sideMenuOverlay")?.addEventListener("click", () => {
    closeSideMenu();
});

// Auto Close Menu when clicking any option inside Menu
document.querySelectorAll(".menu-item-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        closeSideMenu();
    });
});

// Click Profile Box to open Profile Popup
document.getElementById("profileHeaderBox")?.addEventListener("click", () => {
    closeSideMenu();
    const profPopup = document.getElementById("profilePopup");
    if (profPopup) profPopup.style.display = "flex";
});

// Close Profile Popup
document.getElementById("closeProfile")?.addEventListener("click", () => {
    const profPopup = document.getElementById("profilePopup");
    if (profPopup) profPopup.style.display = "none";
});

// Save Profile
document.getElementById("saveProfile")?.addEventListener("click", async () => {
    let name = document.getElementById("profileName")?.value.trim();
    if (name && currentUserMobile) {
        try {
            await set(ref(db, `users/${currentUserMobile}/name`), name);
            
            const menuNameElem = document.getElementById("menuUserName");
            if (menuNameElem) menuNameElem.innerText = name;

            alert("Profile Updated Successfully!");
            const profPopup = document.getElementById("profilePopup");
            if (profPopup) profPopup.style.display = "none";
        } catch (err) {
            console.error("Profile Save Error:", err);
            alert("Failed to update profile!");
        }
    } else {
        alert("Please enter a valid name!");
    }
});



// realtime recharge section 

let currentUpiId = "yourname@upi";
let payeeName = "Matka Wallet";
let currentReqKey = null;

// Firebase se UPI Settings Sync
if (typeof db !== "undefined") {
    onValue(ref(db, "app_settings"), (snapshot) => {
        const data = snapshot.val();
        if (data && data.upi_id) {
            currentUpiId = data.upi_id;
            if (data.payee_name) payeeName = data.payee_name;
        }
    });
}

// Quick Amount Selector
window.setQuickAmount = function(amt) {
    const amtInput = document.getElementById("rechargeAmount");
    if (amtInput) amtInput.value = amt;
};

// Copy UPI Functionality
document.getElementById("copyUpiBtn")?.addEventListener("click", () => {
    if (currentUpiId) {
        navigator.clipboard.writeText(currentUpiId);
        alert("✅ UPI ID Copied Successfully!");
    }
});

// Open Recharge Popup
document.getElementById("rechargeBtn")?.addEventListener("click", () => {
    document.getElementById("sideMenu")?.classList.remove("active");
    const rechPopup = document.getElementById("rechargePopup");
    if (rechPopup) {
        rechPopup.style.display = "flex";
        document.getElementById("rechargeStep1").style.display = "block";
        document.getElementById("rechargeStep2").style.display = "none";
        const amtInput = document.getElementById("rechargeAmount");
        if (amtInput) amtInput.value = "";
    }
});

// Close Header Button
document.getElementById("closeRecharge")?.addEventListener("click", () => {
    const rechPopup = document.getElementById("rechargePopup");
    if (rechPopup) rechPopup.style.display = "none";
});

// Proceed To Pay Button Click Handler (FIXED & SAFE)
document.getElementById("proceedToPayBtn")?.addEventListener("click", async () => {
    const amountVal = document.getElementById("rechargeAmount")?.value;
    const amount = parseInt(amountVal);

    if (!amount || isNaN(amount) || amount < 100) {
        return alert("⚠️ Minimum Deposit Amount is ₹100");
    }

    // Set Displays
    const displayAmtEl = document.getElementById("displayPayAmount");
    const displayUpiEl = document.getElementById("displayUpiId");
    if (displayAmtEl) displayAmtEl.innerText = amount;
    if (displayUpiEl) displayUpiEl.innerText = currentUpiId;

    // Generate Ref Code
    const refCode = "REF" + Math.floor(1000 + Math.random() * 9000);
    const displayRefEl = document.getElementById("displayRefCode");
    if (displayRefEl) displayRefEl.innerText = refCode;

    // Safe Mobile Number Check
    const userMob = typeof currentUserMobile !== "undefined" && currentUserMobile ? currentUserMobile : "GUEST_USER";

    // Push Request to Realtime Database
    try {
        if (typeof db !== "undefined") {
            const reqRef = push(ref(db, "recharge_requests"));
            currentReqKey = reqRef.key;

            await set(reqRef, {
                userMobile: userMob,
                amount: amount,
                utr: refCode,
                status: "PENDING",
                timestamp: Date.now()
            });

            // Start Realtime Listener for Auto-Approval
            listenForAutoApproval(currentReqKey);
        }
    } catch (err) {
        console.error("Firebase Push Error:", err);
    }

    // Generate Dynamic QR Code
    const upiUrl = `upi://pay?pa=${currentUpiId}&pn=${encodeURIComponent(payeeName)}&am=${amount}&tn=${refCode}&cu=INR`;
    const qrImgEl = document.getElementById("qrImage");
    if (qrImgEl) {
        qrImgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUrl)}`;
    }

    // Switch Screens Smoothly
    document.getElementById("rechargeStep1").style.display = "none";
    document.getElementById("rechargeStep2").style.display = "block";
});

// Listener for Automatic Status Update
// Active Listener Unsubscribe Reference
let currentRechargeUnsub = null;

// Realtime Listener for CURRENT Active Request
function listenForAutoApproval(reqKey) {
    if (typeof db === "undefined" || !reqKey) return;

    // Pehle se chal rahe listener ko band karein
    if (typeof currentRechargeUnsub === "function") {
        currentRechargeUnsub();
        currentRechargeUnsub = null;
    }

    // Direct Sirf ISpecific Current Request Ko Listen Karein
    const singleReqRef = ref(db, `recharge_requests/${reqKey}`);

    currentRechargeUnsub = onValue(singleReqRef, (snapshot) => {
        const data = snapshot.val();
        
        // Jab tak status PENDING hai tab tak kuch nahi hoga (QR Screen dikhti rahegi)
        if (data && data.status === "APPROVED") {

            // 1. Recharge Screen Hide Karein
            const rechPopup = document.getElementById("rechargePopup");
            if (rechPopup) rechPopup.style.display = "none";

            // 2. Success Popup Modal Display Karein
            const successModal = document.getElementById("rechargeSuccessModal");
            if (successModal) {
                successModal.style.cssText = "display: flex !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(0,0,0,0.8) !important; z-index: 9999999 !important; align-items: center !important; justify-content: center !important;";
            }

            // 3. Popup aane ke baad listener disconnect kar do
            if (typeof currentRechargeUnsub === "function") {
                currentRechargeUnsub();
                currentRechargeUnsub = null;
            }
        }
    });
}

// Close Success Modal Handler
document.getElementById("closeSuccessModal")?.addEventListener("click", () => {
    const successModal = document.getElementById("rechargeSuccessModal");
    if (successModal) {
        successModal.style.display = "none";
    }
});


// Withdrawal Ke Liye

// Time Checker Function (07:00 AM to 10:00 AM)
function isWithdrawalTimeValid() {
    const now = new Date();
    const currentHour = now.getHours(); 
    return currentHour >= 7 && currentHour < 10;
}

let currentMethod = "UPI"; // Default tab

// Open Withdrawal Page & Show Pre-Warning Notice
document.getElementById("withdrawBtn")?.addEventListener("click", () => {
    document.getElementById("sideMenu")?.classList.remove("active");
    const withdrawPopup = document.getElementById("withdrawPopup");
    const noticeModal = document.getElementById("withdrawNoticeModal");

    if (withdrawPopup) withdrawPopup.style.display = "flex";
    if (noticeModal) noticeModal.style.display = "flex"; // Show Warning Notice

    // Reset All Inputs
    ["withdrawAmount", "upiId", "bankHolder", "bankAccNo", "bankIfsc", "bankName", "withdrawNumber"].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
    });

    const sendBtn = document.getElementById("sendWithdraw");
    const msgElem = document.getElementById("withdrawMessage");

    if (!isWithdrawalTimeValid()) {
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.style.background = "#cbd5e1";
            sendBtn.style.cursor = "not-allowed";
        }
        if (msgElem) msgElem.innerText = "❌ Withdrawal is CLOSED now. Available only 07:00 AM to 10:00 AM.";
    } else {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.style.background = "#10b981";
            sendBtn.style.cursor = "pointer";
        }
        if (msgElem) msgElem.innerText = "";
    }
});

// Close Notice Modal
document.getElementById("closeWithdrawNotice")?.addEventListener("click", () => {
    const noticeModal = document.getElementById("withdrawNoticeModal");
    if (noticeModal) noticeModal.style.display = "none";
});

// Tab Switcher Logic
document.querySelectorAll(".w-tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
        document.querySelectorAll(".w-tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".w-tab-pane").forEach(p => p.style.display = "none");

        e.target.classList.add("active");
        const tabId = e.target.getAttribute("data-wtab");
        document.getElementById(tabId).style.display = "block";

        if (tabId === "upiTab") currentMethod = "UPI";
        if (tabId === "bankTab") currentMethod = "BANK";
        if (tabId === "mobileTab") currentMethod = "MOBILE";
    });
});

// Back / Close Button
document.getElementById("closeWithdraw")?.addEventListener("click", () => {
    const withdrawPopup = document.getElementById("withdrawPopup");
    if (withdrawPopup) withdrawPopup.style.display = "none";
});

// Mobile number input 10-digit restrict
document.getElementById("withdrawNumber")?.addEventListener("input", function () {
    this.value = this.value.replace(/[^0-9]/g, "").slice(0, 10);
});

// Submit Request Handler
document.getElementById("sendWithdraw")?.addEventListener("click", async () => {
    if (!isWithdrawalTimeValid()) {
        alert("❌ Withdrawal request failed. Timing is only between 07:00 AM to 10:00 AM!");
        return;
    }

    const amount = parseInt(document.getElementById("withdrawAmount")?.value);
    const msgElem = document.getElementById("withdrawMessage");

    if (isNaN(amount) || amount < 500) {
        if (msgElem) msgElem.innerText = "Minimum withdrawal amount is ₹500!";
        return;
    }

    let paymentDetails = { method: currentMethod };

    // Validations based on Tab
    if (currentMethod === "UPI") {
        const upiId = document.getElementById("upiId")?.value.trim();
        if (!upiId || !upiId.includes("@")) {
            if (msgElem) msgElem.innerText = "Enter valid UPI ID (e.g. name@upi)";
            return;
        }
        paymentDetails.upiId = upiId;
        paymentDetails.payNumber = upiId; // Backwards compatibility for history
    } else if (currentMethod === "BANK") {
        const holder = document.getElementById("bankHolder")?.value.trim();
        const accNo = document.getElementById("bankAccNo")?.value.trim();
        const ifsc = document.getElementById("bankIfsc")?.value.trim().toUpperCase();
        const bName = document.getElementById("bankName")?.value.trim();

        if (!holder || !accNo || !ifsc || !bName) {
            if (msgElem) msgElem.innerText = "Fill all Bank Details properly!";
            return;
        }
        paymentDetails.bankHolder = holder;
        paymentDetails.accountNumber = accNo;
        paymentDetails.ifsc = ifsc;
        paymentDetails.bankName = bName;
        paymentDetails.payNumber = `A/C: ${accNo.slice(-4)} (${ifsc})`; 
    } else if (currentMethod === "MOBILE") {
        const mob = document.getElementById("withdrawNumber")?.value.trim();
        if (!mob || mob.length !== 10) {
            if (msgElem) msgElem.innerText = "Enter valid 10-digit Mobile Number!";
            return;
        }
        paymentDetails.mobileNumber = mob;
        paymentDetails.payNumber = mob;
    }

    if (msgElem) msgElem.innerText = "Processing request...";

    const walletRef = ref(db, `users/${currentUserMobile}/wallet`);

    try {
        const result = await runTransaction(walletRef, (currentWallet) => {
            if (currentWallet === null) return 0;
            if (currentWallet < amount) return;
            return currentWallet - amount;
        });

        if (!result.committed) {
            if (msgElem) msgElem.innerText = "❌ Insufficient Wallet Balance!";
            return;
        }

        // Save Request in DB with dynamic payload
        const withdrawRef = push(ref(db, "withdraw_requests"));
        await set(withdrawRef, {
            userMobile: currentUserMobile,
            amount: amount,
            status: "PENDING",
            timestamp: Date.now(),
            ...paymentDetails
        });

        // Hide main page & Show Success Modal
        document.getElementById("withdrawPopup").style.display = "none";
        const successModal = document.getElementById("withdrawSuccessModal");
        const successText = document.getElementById("withdrawSuccessText");
        
        if (successText) {
            successText.innerText = `Withdrawal Request of ₹${amount} via ${currentMethod} Submitted Successfully!`;
        }
        if (successModal) successModal.style.display = "flex";

    } catch (error) {
        console.error("Withdrawal Error:", error);
        if (msgElem) msgElem.innerText = "Transaction failed. Please check internet.";
    }
});

// Close Success Popup
document.getElementById("closeWithdrawSuccess")?.addEventListener("click", () => {
    document.getElementById("withdrawSuccessModal").style.display = "none";
});

// --- ALL-IN-ONE HISTORY SYSTEM ---
document.getElementById("historyBtn")?.addEventListener("click", () => {
    document.getElementById("sideMenu")?.classList.remove("active");
    const historyPopup = document.getElementById("historyPopup");
    if (historyPopup) {
        historyPopup.style.display = "flex";
        loadAllHistories();
    }
});

document.getElementById("closeHistory")?.addEventListener("click", () => {
    const historyPopup = document.getElementById("historyPopup");
    if (historyPopup) historyPopup.style.display = "none";
});

// Tab Switch Logic
const tabBtns = document.querySelectorAll(".history-tabs .tab-btn");
tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        tabBtns.forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(pane => pane.classList.remove("active"));

        btn.classList.add("active");
        const activeTabId = btn.getAttribute("data-tab");
        const activePane = document.getElementById(activeTabId);
        if (activePane) activePane.classList.add("active");
    });
});

function formatTimestamp(ts) {
    if (!ts) return "--";
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function loadAllHistories() {
    if (!currentUserMobile) return;

    loadBidsHistory();
    loadRechargeHistory();
    loadWithdrawHistory();
}

// 3.1 Fetch Bids History (Indexed & Secure Query)
function loadBidsHistory() {
    const bidsList = document.getElementById("bidsList");
    if (!bidsList) return;

    const bidsQuery = query(ref(db, "bids"), orderByChild("userMobile"), equalTo(currentUserMobile));
    
    onValue(bidsQuery, (snapshot) => {
        bidsList.innerHTML = "";
        let userBids = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                userBids.push(child.val());
            });
        }

        if (userBids.length === 0) {
            bidsList.innerHTML = "<p style='text-align:center; color:#999; padding:20px; font-weight:bold;'>No bids placed yet.</p>";
            return;
        }

        // Latest Bids First
        userBids.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        userBids.forEach(bid => {
            const rawStatus = (bid.status || 'PENDING').toUpperCase();
            
            let statusBg = "#fef3c7";
            let statusTextColor = "#d97706";
            let resultMessage = `<span style="color:#16a34a;">Best Of Luck !</span>`;

            if (rawStatus === 'WIN') {
                statusBg = "#d1fae5";
                statusTextColor = "#059669";
                resultMessage = `<span style="color:#16a34a;">Congratulation ! You Win</span>`;
            } else if (rawStatus === 'LOSS' || rawStatus === 'LOST') {
                statusBg = "#fee2e2";
                statusTextColor = "#dc2626";
                resultMessage = `<span style="color:#dc2626;">Better Luck ! Next Time</span>`;
            }

            // Market Name + Session Check
            const rawMarket = (bid.marketName || bid.marketId || 'MARKET').toUpperCase();
            const sessionVal = (bid.session || 'OPEN').toUpperCase();
            const headerTitle = rawMarket.includes("STARLINE") ? rawMarket : `${rawMarket} (${sessionVal})`;

            // Date and Time Formatting
            let dateStr = "N/A";
            let timeStr = "N/A";
            if (bid.timestamp) {
                const dt = new Date(bid.timestamp);
                dateStr = dt.toLocaleDateString("en-IN", { day: '2-digit', month: '2-digit', year: 'numeric' });
                timeStr = dt.toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit', hour12: true });
            }

            const item = document.createElement("div");
            item.style.cssText = `
                background: #fffbeb;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 10px rgba(0,0,0,0.06);
                margin-bottom: 16px;
                border: 1.5px solid #fcd34d;
                font-family: sans-serif;
            `;

            item.innerHTML = `
                <!-- 1. Header (#ffc107) -->
                <div style="background:#ffc107; color:#1e293b; font-weight:800; text-align:center; padding:10px; font-size:16px; letter-spacing:0.5px;">
                    ${headerTitle}
                </div>

                <div style="padding:14px;">
                    <!-- 2. Status & Win Amount Row -->
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div>
                            <span style="font-size:15px; font-weight:800; color:#374151;">Status : </span>
                            <span style="background:${statusBg}; color:${statusTextColor}; padding:4px 10px; border-radius:6px; font-size:13px; font-weight:800;">${rawStatus}</span>
                        </div>
                        ${rawStatus === 'WIN' ? `<div style="color:#16a34a; font-weight:800; font-size:16px;">Win: +${bid.winAmount || 0}</div>` : ''}
                    </div>

                    <div style="border-top:1px solid #fde68a; margin-bottom:10px;"></div>

                    <!-- 3. Bid | Point | Type Table -->
                    <div style="display:flex; justify-content:space-between; text-align:center; font-weight:800; color:#4b5563; font-size:15px; margin-bottom:6px;">
                        <span style="flex:1;">Bid</span>
                        <span style="flex:1;">Point</span>
                        <span style="flex:1;">Type</span>
                    </div>

                    <div style="display:flex; justify-content:space-between; text-align:center; font-weight:800; color:#111827; font-size:15px; margin-bottom:12px;">
                        <span style="flex:1;">${bid.bidNumber || '---'}</span>
                        <span style="flex:1;">${bid.points || 0}</span>
                        <span style="flex:1;">${(bid.gameType || 'SINGLE DIGIT').toUpperCase()}</span>
                    </div>

                    <div style="border-top:1px solid #fde68a; margin-bottom:10px;"></div>

                    <!-- 4. Result Message (Best of Luck / Win / Lost Message) -->
                    <div style="text-align:center; font-size:15px; font-weight:800; margin-bottom:10px;">
                        ${resultMessage}
                    </div>

                    <div style="border-top:1px solid #fde68a; margin-bottom:10px;"></div>

                    <!-- 5. Date & Time Row (Bottom Most) -->
                    <div style="display:flex; justify-content:space-between; font-size:14px; color:#111827; font-weight:800; padding:0 5px;">
                        <span>Date : ${dateStr}</span>
                        <span>Time : ${timeStr}</span>
                    </div>
                </div>
            `;
            
            bidsList.appendChild(item);
        });
    });
}

// 3.2 Fetch Recharge History (Indexed & Secure Query)
function loadRechargeHistory() {
    const rechargeList = document.getElementById("rechargeList");
    if (!rechargeList) return;

    const reqQuery = query(ref(db, "recharge_requests"), orderByChild("userMobile"), equalTo(currentUserMobile));

    onValue(reqQuery, (snapshot) => {
        rechargeList.innerHTML = "";
        let userRecharges = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                userRecharges.push(child.val());
            });
        }

        if (userRecharges.length === 0) {
            rechargeList.innerHTML = "<p style='text-align:center; color:#999; padding:20px;'>No recharge history found.</p>";
            return;
        }

        userRecharges.sort((a, b) => b.timestamp - a.timestamp);

        userRecharges.forEach(req => {
            const item = document.createElement("div");
            item.className = `history-item status-${req.status || 'PENDING'}`;
            item.innerHTML = `
                <div class="history-item-header">
                    <span>Amount: ₹${req.amount}</span>
                    <span class="badge-status badge-${req.status || 'PENDING'}">${req.status || 'PENDING'}</span>
                </div>
                <div class="history-item-body">
                    <div><b>UTR:</b> ${req.utr}</div>
                    <div>${formatTimestamp(req.timestamp)}</div>
                </div>
            `;
            rechargeList.appendChild(item);
        });
    });
}

// 3.3 Fetch Withdraw History (Indexed & Secure Query)
function loadWithdrawHistory() {
    const withdrawList = document.getElementById("withdrawList");
    if (!withdrawList) return;

    const activeMobile = currentUserMobile || localStorage.getItem("userMobile") || localStorage.getItem("loggedInUser");

    if (!activeMobile) {
        withdrawList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>Please login to view history.</p>";
        return;
    }

    const reqQuery = query(
        ref(db, "withdraw_requests"), 
        orderByChild("userMobile"), 
        equalTo(activeMobile)
    );

    onValue(reqQuery, (snapshot) => {
        withdrawList.innerHTML = "";
        let userWithdraws = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                userWithdraws.push(child.val());
            });
        }

        if (userWithdraws.length === 0) {
            withdrawList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>No withdrawal history found.</p>";
            return;
        }

        // Newest history top par
        userWithdraws.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        userWithdraws.forEach(req => {
            const rawStatus = (req.status || 'PENDING').toUpperCase();
            
            // Status-based Badges & Classes
            let statusClass = "status-PENDING";
            let badgeClass = "badge-PENDING";
            let statusText = "PENDING";

            if (rawStatus === "SUCCESS" || rawStatus === "APPROVED") {
                statusClass = "status-SUCCESS";
                badgeClass = "badge-SUCCESS";
                statusText = rawStatus;
            } else if (rawStatus === "REJECTED" || rawStatus === "FAILED") {
                statusClass = "status-REJECTED";
                badgeClass = "badge-REJECTED";
                statusText = rawStatus;
            }

            const formattedTime = typeof formatTimestamp === "function" 
                ? formatTimestamp(req.timestamp) 
                : (req.timestamp ? new Date(req.timestamp).toLocaleString() : '');

            // Dynamic Detail Text based on Selected Payment Method
            let detailHTML = "";
            const method = (req.method || 'MOBILE').toUpperCase();

            if (method === "BANK") {
                detailHTML = `
                    <div style="margin-bottom: 4px;"><b>Method:</b> 🏦 BANK TRANSFER</div>
                    <div style="margin-bottom: 2px;"><b>Name:</b> ${req.bankHolder || '-'}</div>
                    <div style="margin-bottom: 2px;"><b>Bank:</b> ${req.bankName || '-'}</div>
                    <div style="margin-bottom: 2px;"><b>A/C No:</b> ${req.accountNumber || '-'}</div>
                    <div><b>IFSC:</b> ${req.ifsc || '-'}</div>
                `;
            } else if (method === "UPI") {
                detailHTML = `
                    <div style="margin-bottom: 4px;"><b>Method:</b> 📱 UPI</div>
                    <div><b>UPI ID:</b> ${req.upiId || req.payNumber || '-'}</div>
                `;
            } else {
                // MOBILE / DEFAULT
                detailHTML = `
                    <div style="margin-bottom: 4px;"><b>Method:</b> 📞 MOBILE PAYMENT</div>
                    <div><b>Number:</b> ${req.mobileNumber || req.payNumber || '-'}</div>
                `;
            }

            const item = document.createElement("div");
            item.className = `history-item ${statusClass}`;
            
            item.innerHTML = `
                <div class="history-item-header">
                    <span>Amount: ₹${req.amount || 0}</span>
                    <span class="badge-status ${badgeClass}">${statusText}</span>
                </div>

                <div class="history-item-body" style="flex-direction: column; align-items: flex-start; gap: 4px; font-size: 13px; color: #334155;">
                    ${detailHTML}
                </div>

                <div style="margin-top: 10px; font-size: 11px; color: #94a3b8; text-align: right; font-weight: 500; border-top: 1px dashed #e2e8f0; padding-top: 6px;">
                    ${formattedTime}
                </div>
            `;

            withdrawList.appendChild(item);
        });
    }, (error) => {
        console.error("Withdrawal History Error:", error);
        withdrawList.innerHTML = "<p style='text-align:center; color:#ef4444; padding:30px; font-weight:600;'>Error loading history.</p>";
    });
}

// --- ADMIN RESULT DECLARATION SYSTEM ---

// Function ke aage 'window.' laga dein taaki ye globally accessible ho jaye
// --- 1. GLOBALLY DEFINE ADMIN FUNCTIONS ---
// --- ADMIN CONFIGURATION ---
window.ADMIN_MOBILE = "8799274536"; // <-- Yahan Apna Admin Mobile Number Likhein (Mobile Number Strings mein hona chahiye)

// 1. Function jo Admin Button ko Menu me add karta hai
window.checkAndShowAdminOption = function(mobile) {
    if (!mobile) return;
    
    // Safety string check
    const currentMobileStr = String(mobile).trim();
    const adminMobileStr = String(window.ADMIN_MOBILE).trim();

    if (currentMobileStr === adminMobileStr) {
        // Aapke side menu ki ID (sideMenu ya sidebar)
        let sideMenu = document.getElementById("sideMenu") || document.getElementById("sidebar");
        
        if (sideMenu && !document.getElementById("adminMenuBtn")) {
            let btn = document.createElement("button");
            btn.id = "adminMenuBtn";
            btn.style.cssText = "background:#c0392b; color:#fff; width:90%; margin:10px auto; padding:12px; border:none; border-radius:5px; font-weight:bold; cursor:pointer; display:block; text-align:center; box-shadow:0 2px 5px rgba(0,0,0,0.2);";
            btn.innerText = "👑 DECLARE RESULT";
            
            btn.onclick = () => {
                if (typeof window.openAdminResultModal === 'function') {
                    window.openAdminResultModal();
                } else {
                    alert("Admin Popup function not ready!");
                }
            };
            
            sideMenu.appendChild(btn);
            console.log("✅ Admin Button Auto-Loaded!");
        }
    }
};

// 2. AUTO-RUN ON PAGE LOAD / REFRESH
document.addEventListener("DOMContentLoaded", () => {
    // LocalStorage se saved logged-in user check karein
    const savedMobile = localStorage.getItem("userMobile") || localStorage.getItem("loggedInUser");
    if (savedMobile) {
        window.checkAndShowAdminOption(savedMobile);
    }
});

// 3. (IMPORTANT) Apne Login Function mein Ye Line Add Karein:
// Jab bhi Admin Login kare: 
// localStorage.setItem("userMobile", loginMobileNumber);
// window.checkAndShowAdminOption(loginMobileNumber);

// Auto Check on Page Refresh/Load


// Open Modal & Fetch Markets
// --- 2. ADMIN MODAL & RESULT ENGINE ---

window.openAdminResultModal = async function() {
    const popup = document.getElementById("adminResultPopup");
    const select = document.getElementById("adminMarketSelect");
    if (!popup || !select) return alert("Admin popup elements missing in HTML!");

    select.innerHTML = "<option value=''>Loading markets...</option>";
    try {
        const snapshot = await get(ref(db, "markets"));
        select.innerHTML = "";
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                let opt = document.createElement("option");
                opt.value = child.key;
                opt.innerText = child.val().name || child.key;
                select.appendChild(opt);
            });
        } else {
            select.innerHTML = "<option value=''>No Markets Found</option>";
        }
        popup.style.display = "flex";
    } catch (err) {
        console.error("Error loading markets:", err);
        alert("Firebase error: Markets load nahi ho paaye.");
    }
};

// Modal close listener
document.getElementById("closeAdminPopup")?.addEventListener("click", () => {
    document.getElementById("adminResultPopup").style.display = "none";
});

// SUBMIT RESULT & DECLARE WINNERS
// --- TODAY'S DATE FORMATTER (DD/MM/YYYY) ---
// --- HELPER FUNCTION: TIMESTAMP SE AAJ KI DATE CHECK KARNA ---
function isBidFromToday(bidTimestamp) {
    if (!bidTimestamp) return false;

    const bidDateObj = new Date(Number(bidTimestamp));
    const targetDateObj = new Date();

    // Cross-Midnight Fix: Agar result raat 12:00 AM se subah 04:00 AM ke beech process ho raha hai
    // Toh check pichle din (yesterday) ki bids ke liye hona chahiye.
    if (targetDateObj.getHours() >= 0 && targetDateObj.getHours() < 4) {
        targetDateObj.setDate(targetDateObj.getDate() - 1);
    }

    return bidDateObj.getDate() === targetDateObj.getDate() &&
           bidDateObj.getMonth() === targetDateObj.getMonth() &&
           bidDateObj.getFullYear() === targetDateObj.getFullYear();
}

// --- HELPER FUNCTION: CHECK PANA TYPE (SINGLE VS DOUBLE) ---
function getPanaType(panaStr) {
    if (!panaStr || panaStr.length !== 3) return "SINGLE_PANA";
    const uniqueDigits = new Set(panaStr.split('')).size;
    if (uniqueDigits === 2) return "DOUBLE_PANA"; // e.g. 112, 122
    if (uniqueDigits === 1) return "TRIPLE_PANA"; // e.g. 111
    return "SINGLE_PANA"; // e.g. 123
}


// --- SUBMIT RESULT HANDLER (WITH DYNAMIC CYCLE PANA RATES) ---
document.getElementById("submitResultBtn")?.addEventListener("click", async () => {
    const marketId = document.getElementById("adminMarketSelect")?.value;
    const session = document.getElementById("adminSessionSelect")?.value;
    const pana = document.getElementById("adminPanaInput")?.value.trim();
    const digit = document.getElementById("adminDigitInput")?.value.trim();

    if (!marketId) return alert("Please select a Market!");
    if (pana.length !== 3 || isNaN(pana)) return alert("Enter valid 3-digit Pana (e.g. 139)!");
    if (digit.length !== 1 || isNaN(digit)) return alert("Enter valid 1-digit Single (e.g. 3)!");

    if (!confirm(`Confirm Result for ${session}?\nPana: ${pana} | Single Digit: ${digit}`)) return;

    // --- GAME RATES FOR ALL 8 GAME TYPES ---
    const GAME_RATES = {
        SINGLE_DIGIT: 9,
        JODI: 90,
        SINGLE_PANA: 150,
        DOUBLE_PANA: 300,
        TRIPLE_PANA: 600,
        CYCLE_PANA: 150, // Default fallback
        SP_MOTOR: 150,
        DP_MOTOR: 300
    };

    try {
        // 1. Fetch Market Data
        const marketRef = ref(db, `markets/${marketId}`);
        const marketSnap = await get(marketRef);
        
        const marketVal = marketSnap.exists() ? marketSnap.val() : {};
        let currentRes = marketVal.result || "***-**-***";
        let marketName = marketVal.name || marketVal.market_name || marketId;
        let openTime = marketVal.open_time || "";
        let closeTime = marketVal.close_time || "";

        let parts = currentRes.split("-");

        let openPana = parts[0] || "***";
        let jodiStr = parts[1] || "**";
        let closePana = parts[2] || "***";

        let calculatedJodi = "";

        if (session === "OPEN") {
            openPana = pana;
            let closeDigit = (jodiStr.length === 2 && jodiStr[1] !== "*") ? jodiStr[1] : "*";
            jodiStr = `${digit}${closeDigit}`;
        } else {
            closePana = pana;
            let openDigit = (jodiStr.length === 2 && jodiStr[0] !== "*") ? jodiStr[0] : "*";
            jodiStr = `${openDigit}${digit}`;

            if (openDigit !== "*") {
                calculatedJodi = `${openDigit}${digit}`;
            }
        }

        // 2. Fetch All Bids
        const bidsSnap = await get(ref(db, "bids"));
        
        if (bidsSnap.exists()) {
            const bidsData = bidsSnap.val();
            const promises = [];

            for (const bidId in bidsData) {
                const bid = bidsData[bidId];

                if (!bid || typeof bid !== 'object') continue;

                // --- 1. MARKET CHECK ---
                if (bid.marketId !== marketId) continue;

                // --- 2. PENDING STATUS CHECK ---
                if (bid.status && bid.status !== "PENDING") continue;

                // --- 3. TIMESTAMP DATE CHECK (OVERNIGHT AWARE) ---
                const rawTimestamp = bid.timestamp || bid.time || bid.created_at || bid.date;
                
                if (!isBidFromToday(rawTimestamp)) {
                    console.log(`Skipping bid ${bidId} because timestamp (${rawTimestamp}) is not matching target game date.`);
                    continue; 
                }

                let isWin = false;

                // --- 4. ALL 8 GAMES WINNING CALCULATION ---
                
                // Single Digit Winning Check
                if (bid.gameType === "SINGLE_DIGIT" && bid.session === session && String(bid.bidNumber) === String(digit)) {
                    isWin = true;
                } 
                // All Pana Types Winning Check
                else if (
                    ["SINGLE_PANA", "DOUBLE_PANA", "TRIPLE_PANA", "CYCLE_PANA", "SP_MOTOR", "DP_MOTOR"].includes(bid.gameType) && 
                    bid.session === session && 
                    String(bid.bidNumber) === String(pana)
                ) {
                    isWin = true;
                } 
                // Jodi Winning Check (Executes only on CLOSE result)
                else if (bid.gameType === "JODI" && session === "CLOSE" && calculatedJodi !== "") {
                    if (String(bid.bidNumber) === String(calculatedJodi)) {
                        isWin = true;
                    }
                }

                // --- 5. PROCESS WALLET & STATUS UPDATE ---
                if (isWin) {
                    let multiplier = GAME_RATES[bid.gameType] || 1;

                    // Dynamic Rate Fix for Cycle Pana
                    if (bid.gameType === "CYCLE_PANA") {
                        const winPanaType = getPanaType(pana);
                        if (winPanaType === "DOUBLE_PANA") {
                            multiplier = GAME_RATES.DOUBLE_PANA;
                        } else {
                            multiplier = GAME_RATES.SINGLE_PANA;
                        }
                    }

                    const winAmount = Math.round(Number(bid.points || 0) * multiplier);

                    if (bid.userMobile) {
                        const walletRef = ref(db, `users/${bid.userMobile}/wallet`);
                        
                        // Wallet balance auto-increment (Transaction)
                        promises.push(runTransaction(walletRef, (curr) => (Number(curr) || 0) + winAmount));
                        
                        // Bid status update to WIN
                        promises.push(set(ref(db, `bids/${bidId}/status`), "WIN"));
                        promises.push(set(ref(db, `bids/${bidId}/winAmount`), winAmount));
                    }
                } else {
                    // Mark LOSS if bid session matches result session
                    if (bid.session === session || (bid.gameType === "JODI" && session === "CLOSE")) {
                        promises.push(set(ref(db, `bids/${bidId}/status`), "LOSS"));
                    }
                }
            }

            await Promise.all(promises);
        }

        // Update Market Display String in Database
        const finalResultString = `${openPana}-${jodiStr}-${closePana}`;
        await set(ref(db, `markets/${marketId}/result`), finalResultString);

        // 🌟 OVERNIGHT-AWARE DECLARED RESULTS DATE
        const nowObj = new Date();
        if (nowObj.getHours() >= 0 && nowObj.getHours() < 4) {
            nowObj.setDate(nowObj.getDate() - 1); // Set to yesterday for midnight results
        }
        const todayDate = nowObj.toISOString().split("T")[0];

        await set(ref(db, `declared_results/${todayDate}/mainMarket/${marketId}`), {
            name: marketName,
            result: finalResultString,
            time: `Open: ${openTime} | Close: ${closeTime}`,
            date: todayDate
        });

        alert(`✅ Result (${finalResultString}) Declared! Today's winners paid successfully.`);
        if(document.getElementById("adminResultPopup")) {
            document.getElementById("adminResultPopup").style.display = "none";
        }

    } catch (err) {
        console.error("Result Error:", err);
        alert(`❌ Error: ${err.message}`);
    }
});

document.getElementById("togglePassword")?.addEventListener("click", function () {
    const passwordInput = document.getElementById("password");
    
    if (passwordInput) {
        if (passwordInput.type === "password") {
            passwordInput.type = "text";
            this.textContent = "🙈"; // Password show hone par icon change
        } else {
            passwordInput.type = "password";
            this.textContent = "👁️"; // Hide hone par normal eye
        }
    }
});


// Auto Closure Time Checker Logic
function isMarketExpired(timeStr) {
    if (!timeStr) return false;
    const now = new Date();
    const [time, modifier] = timeStr.split(" ");
    let [hours, minutes] = time.split(":").map(Number);
    if (modifier === "PM" && hours < 12) hours += 12;
    if (modifier === "AM" && hours === 12) hours = 0;

    const marketTime = new Date();
    marketTime.setHours(hours, minutes, 0, 0);

    return now >= marketTime;
}

// ==================== COMPLETE STARLINE ENGINE (FIREBASE INTEGRATED) ====================

let starlinePendingBidsList = [];
let currentStarlineGameType = "";
let currentStarlineMarket = "";

// ---------------- 1. MATKA PANA GENERATORS & VALIDATORS ----------------

// Matka Custom Sorting Function (0 sabse bada / aakhri hota hai)
function sortMatkaDigits(str) {
    const customOrder = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    return Array.from(new Set(str.split(""))).sort((a, b) => customOrder.indexOf(a) - customOrder.indexOf(b));
}

// Single Pana Validation (3 Distinct Digits)
function isStarlineSinglePana(p) {
    if (p.length !== 3 || isNaN(p)) return false;
    return (p[0] !== p[1]) && (p[1] !== p[2]) && (p[0] !== p[2]);
}

// Double Pana Validation (Exact 2 Same Digits)
function isStarlineDoublePana(p) {
    if (p.length !== 3 || isNaN(p)) return false;
    const [d1, d2, d3] = p.split("");
    return (d1 === d2 && d1 !== d3) || (d2 === d3 && d2 !== d1) || (d1 === d3 && d1 !== d2);
}

// Triple Pana Validation (All 3 Digits Same)
function isStarlineTriplePana(p) {
    if (p.length !== 3 || isNaN(p)) return false;
    return (p[0] === p[1]) && (p[1] === p[2]);
}

// Fixed SP Pana Generator (Matka Rules)
function generateStarlineSPPanas(str) {
    const d = sortMatkaDigits(str);
    let res = [];
    for (let i = 0; i < d.length; i++)
        for (let j = i + 1; j < d.length; j++)
            for (let k = j + 1; k < d.length; k++)
                res.push(d[i] + d[j] + d[k]);
    return res;
}

// Fixed DP Pana Generator (Matka Rules)
function generateStarlineDPPanas(str) {
    const d = sortMatkaDigits(str);
    let res = [];
    for (let i = 0; i < d.length; i++) {
        for (let j = 0; j < d.length; j++) {
            if (i !== j) {
                const triple = [d[i], d[i], d[j]];
                const sortedTriple = triple.sort((a, b) => {
                    const order = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
                    return order.indexOf(a) - order.indexOf(b);
                });
                res.push(sortedTriple.join(""));
            }
        }
    }
    return Array.from(new Set(res));
}

// Fixed Cycle Pana Generator (Matka Rule: '0' always at the end)
function generateStarlineCyclePanas(twoDigits) {
    if (twoDigits.length !== 2 || isNaN(twoDigits)) return [];

    const d1 = parseInt(twoDigits[0]);
    const d2 = parseInt(twoDigits[1]);
    const cyclePanas = [];

    for (let i = 0; i <= 9; i++) {
        let arr = [d1, d2, i];

        // Matka Rules: '0' hamesha last me aayega (e.g., 1, 2, 0 -> 120)
        arr.sort((a, b) => {
            if (a === 0) return 1;
            if (b === 0) return -1;
            return a - b;
        });

        let panaStr = arr.join("");
        if (!cyclePanas.includes(panaStr)) {
            cyclePanas.push(panaStr);
        }
    }
    return cyclePanas;
}

// ---------------- 2. UI RESET & POPUP CONTROL ----------------

function openStarlineBiddingPopup(marketName, marketId, timeSlot) {
    currentStarlineMarket = marketName || "STARLINE";

    // Set Header Title
    const titleElem = document.getElementById("starlineMarketTitle");
    if (titleElem) {
        titleElem.innerText = `STARLINE ${currentStarlineMarket}`;
        titleElem.setAttribute("data-market-id", marketId || "");
        titleElem.setAttribute("data-time-slot", timeSlot || "");
    }

    // Reset Memory & Screens
    starlinePendingBidsList = [];
    currentStarlineGameType = "";
    
    document.getElementById("starlineBiddingView").style.setProperty("display", "none", "important");
    document.getElementById("starlineSubmitFooter").style.setProperty("display", "none", "important");
    document.getElementById("starlineGamesView").style.display = "block";
    
    renderStarlineBidsTable();

    // Show Main Screen Popup
    const popup = document.getElementById("starlineBidPopup");
    if (popup) popup.style.setProperty("display", "block", "important");
}

function closeStarlineBiddingPopup() {
    const popup = document.getElementById("starlineBiddingPage");
    if (popup) popup.style.setProperty("display", "none", "important");
}

// ---------------- 3. EVENT LISTENERS INITIALIZATION ----------------

document.addEventListener("DOMContentLoaded", () => {
    
    // A. Side Menu Starline Button Listener (Fixed Navigation Trigger)
    const starlineBtn = document.getElementById("starlineBtn");
    if (starlineBtn) {
        starlineBtn.addEventListener("click", () => {
            // Close Side Menu Overlay
            const sideMenu = document.getElementById("sideMenu");
            if (sideMenu) {
                sideMenu.classList.remove("active");
                sideMenu.style.left = "";
            }

            const menuOverlay = document.getElementById("menuOverlay");
            if (menuOverlay) menuOverlay.classList.remove("active");

            // Open Starline Base Screen / Load Markets
            const starlinePage = document.getElementById("starlinePage");
            if (starlinePage) {
                starlinePage.style.display = "block";
            }
            if (typeof loadStarlineMarkets === "function") {
                loadStarlineMarkets();
            }
        });
    }

    // B. Close Main Starline Page Listener
    const closeStarlinePage = document.getElementById("closeStarlinePage");
    if (closeStarlinePage) {
        closeStarlinePage.addEventListener("click", () => {
            const starlinePage = document.getElementById("starlinePage");
            if (starlinePage) starlinePage.style.display = "none";
        });
    }

    // C. Back Button inside Bidding Popup
    const closeBtn = document.getElementById("closeStarlineBidBtn");
    if (closeBtn) {
        closeBtn.onclick = () => {
            const biddingView = document.getElementById("starlineBiddingView");
            if (biddingView && biddingView.style.display !== "none") {
                // Return to 7 Game Selection Grid View
                biddingView.style.setProperty("display", "none", "important");
                document.getElementById("starlineSubmitFooter").style.setProperty("display", "none", "important");
                document.getElementById("starlineGamesView").style.display = "block";
            } else {
              resetStarlineBidFormCompletely(); // Reset Form Data
                closeStarlineBiddingPopup();
            }
        };
    }

    // D. Game Card Click Listener (Grid Selection -> Form Screen)
    document.addEventListener("click", (e) => {
        const card = e.target.closest(".starline-game-card");
        if (!card) return;

        currentStarlineGameType = card.getAttribute("data-game");
        const hiddenSelect = document.getElementById("starlineGameType");
        if (hiddenSelect) hiddenSelect.value = currentStarlineGameType;

        // View Transition
        document.getElementById("starlineGamesView").style.display = "none";
        document.getElementById("starlineBiddingView").style.setProperty("display", "block", "important");
        document.getElementById("starlineSubmitFooter").style.setProperty("display", "flex", "important");

        // Format Dynamic Inputs
        const numInput = document.getElementById("starlineBidNumber");
        const labelElem = document.getElementById("starlineInputLabel");
        const msgElem = document.getElementById("starlineBidMessage");

        if (msgElem) msgElem.innerText = "";
        if (numInput) numInput.value = "";

        if (currentStarlineGameType === "SINGLE_DIGIT") {
            labelElem.innerText = "ENTER SINGLE DIGIT :";
            numInput.maxLength = 1;
            numInput.placeholder = "";
        } else if (currentStarlineGameType === "SINGLE_PANA") {
            labelElem.innerText = "ENTER SINGLE PANA :";
            numInput.maxLength = 3;
            numInput.placeholder = "";
        } else if (currentStarlineGameType === "DOUBLE_PANA") {
            labelElem.innerText = "ENTER DOUBLE PANA :";
            numInput.maxLength = 3;
            numInput.placeholder = "";
        } else if (currentStarlineGameType === "TRIPLE_PANA") {
            labelElem.innerText = "ENTER TRIPLE PANA :";
            numInput.maxLength = 3;
            numInput.placeholder = "";
        } else if (currentStarlineGameType === "CYCLE_PANA") {
            labelElem.innerText = "ENTER CYCLE PANA :";
            numInput.maxLength = 2;
            numInput.placeholder = "";
        } else if (currentStarlineGameType === "SP_MOTOR" || currentStarlineGameType === "DP_MOTOR") {
            labelElem.innerText = `ENTER ${currentStarlineGameType.replace('_', ' ')} DIGITS :`;
            numInput.maxLength = 10;
            numInput.placeholder = "";
        }
    });

    // E. Add More Button (Validation + Combination Logic)
    const addMoreBtn = document.getElementById("starlineAddMoreBtn");
    if (addMoreBtn) {
        addMoreBtn.onclick = () => {
            const msgElem = document.getElementById("starlineBidMessage");
            if (msgElem) msgElem.innerText = "";

            const inputVal = document.getElementById("starlineBidNumber").value.trim();
            const points = Number(document.getElementById("starlineBidPoints").value);

            if (!currentStarlineGameType) {
                if (msgElem) msgElem.innerText = "Please select a game type first."; return;
            }

            // Validations
            if (currentStarlineGameType === "SINGLE_DIGIT" && (inputVal.length !== 1 || isNaN(inputVal))) {
                if (msgElem) msgElem.innerText = "Enter valid Single Digit (0-9)"; return;
            }
            if (currentStarlineGameType === "SINGLE_PANA" && !isStarlineSinglePana(inputVal)) {
                if (msgElem) msgElem.innerText = "Invalid Single Pana! (All 3 digits must be different)"; return;
            }
            if (currentStarlineGameType === "DOUBLE_PANA" && !isStarlineDoublePana(inputVal)) {
                if (msgElem) msgElem.innerText = "Invalid Double Pana! (2 digits must be same)"; return;
            }
            if (currentStarlineGameType === "TRIPLE_PANA" && !isStarlineTriplePana(inputVal)) {
                if (msgElem) msgElem.innerText = "Invalid Triple Pana! (All 3 digits must be same)"; return;
            }
            if (currentStarlineGameType === "CYCLE_PANA" && (inputVal.length !== 2 || isNaN(inputVal))) {
                if (msgElem) msgElem.innerText = "Enter exactly 2 digits for Cycle Pana"; return;
            }
            if ((currentStarlineGameType === "SP_MOTOR" || currentStarlineGameType === "DP_MOTOR") && (inputVal.length < 3 || isNaN(inputVal))) {
                if (msgElem) msgElem.innerText = "Enter minimum 3 digits for Motor Pana"; return;
            }
            if (!points || points < 10) {
                if (msgElem) msgElem.innerText = "Minimum points per bid is ₹10"; return;
            }

            // Generate Bids Array
            let generatedPanas = [];
            if (currentStarlineGameType === "CYCLE_PANA") {
                generatedPanas = generateStarlineCyclePanas(inputVal);
            } else if (currentStarlineGameType === "SP_MOTOR") {
                generatedPanas = generateStarlineSPPanas(inputVal);
            } else if (currentStarlineGameType === "DP_MOTOR") {
                generatedPanas = generateStarlineDPPanas(inputVal);
            } else {
                generatedPanas = [inputVal];
            }

            // Add To Pending Bids Array
            generatedPanas.forEach(num => {
                starlinePendingBidsList.push({
                    gameType: currentStarlineGameType,
                    number: num,
                    points: points
                });
            });

            renderStarlineBidsTable();

            // Clear Input Fields
            document.getElementById("starlineBidNumber").value = "";
            document.getElementById("starlineBidPoints").value = "";
        };
    }

    // F. Submit Bids to Firebase (With Wallet Transaction)
    const submitBtn = document.getElementById("submitStarlineBidBtn");
    if (submitBtn) {
        submitBtn.onclick = () => {
            if (starlinePendingBidsList.length === 0) {
                return alert("Please add at least one bid!");
            }

            const totalAmount = starlinePendingBidsList.reduce((sum, b) => sum + Number(b.points), 0);
            const userMobile = localStorage.getItem("userMobile") || (typeof loggedUserMobile !== "undefined" ? loggedUserMobile : null);

            if (!userMobile) {
                return alert("User session not found! Please log in again.");
            }

            const walletRef = ref(db, `users/${userMobile}/wallet`);

            // Firebase Wallet Transaction
            runTransaction(walletRef, (currBal) => {
                if ((currBal || 0) >= totalAmount) {
                    return currBal - totalAmount;
                } else {
                    return; // Abort transaction if low balance
                }
            }).then((res) => {
                if (!res.committed) {
                    return alert("Insufficient Wallet Balance!");
                }

                // Push Bids to Realtime Database

starlinePendingBidsList.forEach(b => {
    push(ref(db, "starline_bids"), {
        userMobile: userMobile,
        marketName: `STARLINE ${currentStarlineMarket}`,
        gameType: b.gameType,
        bidNumber: b.number,
        points: b.points,
        status: "PENDING",
        timestamp: Date.now()
    });
});

                // Show Success Popup
                const successPopup = document.getElementById("starlineSuccessPopup");
                const successDetails = document.getElementById("starlineSuccessDetails");
                
                if (successDetails) {
                    successDetails.innerText = `Bids: ${starlinePendingBidsList.length} | Total Points: ${totalAmount}`;
                }
                if (successPopup) {
                    successPopup.style.setProperty("display", "flex", "important");
                }
            }).catch((err) => {
                alert("Transaction Failed: " + err.message);
            });
        };
    }

    // G. Close Success Popup Listener
    const closeSuccessBtn = document.getElementById("starlineCloseSuccessBtn");
    if (closeSuccessBtn) {
        closeSuccessBtn.onclick = () => {
            const successPopup = document.getElementById("starlineSuccessPopup");
            if (successPopup) successPopup.style.setProperty("display", "none", "important");
            resetStarlineBidFormCompletely(); // Reset Form Data
            closeStarlineBiddingPopup();
        };
    }
});

// ---------------- 4. RENDER TABLE & DELETE ROW ----------------

function renderStarlineBidsTable() {
    const tableBody = document.getElementById("starlineTableBody");
    const tableSection = document.getElementById("starlineTableSection");
    const countSpan = document.getElementById("starlineTotalBidsCount");
    const totalPointsSpan = document.getElementById("starlineTotalPointsDisplay");

    if (!tableBody) return;

    tableBody.innerHTML = "";

    if (starlinePendingBidsList.length === 0) {
        if (tableSection) tableSection.style.display = "none";
        if (countSpan) countSpan.innerText = "0";
        if (totalPointsSpan) totalPointsSpan.innerText = "0";
        return;
    }

    if (tableSection) tableSection.style.display = "block";

    let grandTotalPoints = 0;

    starlinePendingBidsList.forEach((bid, index) => {
        grandTotalPoints += Number(bid.points);

        const row = document.createElement("div");
        row.className = "matka-table-row";
        row.innerHTML = `
            <span><b>${bid.number}</b></span>
            <span>${bid.points}</span>
            <span>${bid.gameType.replace('_', ' ')}</span>
            <span>
                <button type="button" class="matka-del-btn" data-index="${index}" title="Delete">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg></button>
            </span>
        `;
        tableBody.appendChild(row);
    });

    if (countSpan) countSpan.innerText = starlinePendingBidsList.length;
    if (totalPointsSpan) totalPointsSpan.innerText = grandTotalPoints;

    // Attach Action Delete Handlers
    document.querySelectorAll("#starlineTableBody .matka-del-btn").forEach(btn => {
        btn.onclick = (e) => {
            const idx = e.currentTarget.getAttribute("data-index");
            starlinePendingBidsList.splice(idx, 1);
            renderStarlineBidsTable();
        };
    });
}

// Function to Completely Reset Starline Bid Form & Return to Game Selection
function resetStarlineBidFormCompletely() {
    // 1. Reset Arrays & State
    starlinePendingBidsList = [];
    currentStarlineGameType = "";

    // 2. Clear Input Fields & Messages
    const numInput = document.getElementById("starlineBidNumber");
    const pointsInput = document.getElementById("starlineBidPoints");
    const msgElem = document.getElementById("starlineBidMessage");
    const previewBox = document.getElementById("starlineCombinationsPreview") || document.getElementById("starlinePanaPreviewBox");

    if (numInput) numInput.value = "";
    if (pointsInput) pointsInput.value = "";
    if (msgElem) msgElem.innerText = "";
    if (previewBox) previewBox.style.display = "none";

    // 3. Reset Dynamic Views (Form Close & Return to Game Cards Grid)
    const gamesView = document.getElementById("starlineGamesView");
    const biddingView = document.getElementById("starlineBiddingView");
    const submitFooter = document.getElementById("starlineSubmitFooter");

    if (gamesView) gamesView.style.setProperty("display", "block", "important");
    if (biddingView) biddingView.style.setProperty("display", "none", "important");
    if (submitFooter) submitFooter.style.setProperty("display", "none", "important");

    // 4. Re-render Table (Will clear rows & reset footer stats to 0)
    renderStarlineBidsTable();
}

// ==================== STARLINE AUTO RESET LOGIC (2:00 AM) ====================
function checkAndResetStarlineMarkets() {
    const todayStr = new Date().toDateString(); // Aaj ki date (e.g. "Sat Aug 08 2026")
    const lastResetDate = localStorage.getItem("starline_last_reset");

    const now = new Date();
    // Check if current time is past 2:00 AM today
    const resetTime = new Date();
    resetTime.setHours(2, 0, 0, 0);

    if (now >= resetTime && lastResetDate !== todayStr) {
        // Firebase me saare Starline markets ka result reset kar do
        get(ref(db, "starline_markets")).then((snap) => {
            if (snap.exists()) {
                const data = snap.val();
                let updates = {};
                
                Object.keys(data).forEach(key => {
                    updates[`starline_markets/${key}/result`] = "***-*";
                    updates[`starline_markets/${key}/status`] = "OPEN";
                });

                update(ref(db), updates).then(() => {
                    localStorage.setItem("starline_last_reset", todayStr);
                    console.log("Starline markets automatically reset for the new day!");
                });
            }
        });
    }
}

// App start hote hi reset check karein
document.addEventListener("DOMContentLoaded", () => {
    checkAndResetStarlineMarkets();
    
    // Har 5 minute me background me bhi check karega
    setInterval(checkAndResetStarlineMarkets, 300000);
});

// ==================== STEP 3: STARLINE HISTORY MODULE ====================
// ================= FIXED STARLINE HISTORY ONLY =================

// ================= EXACT SAME LOGIC AS MAIN MARKET =================

function loadStarlineHistory() {
    const starlineList = document.getElementById("starlineHistoryList");
    if (!starlineList) return;

    const activeMobile = currentUserMobile || localStorage.getItem("userMobile") || localStorage.getItem("loggedInUser");

    if (!activeMobile) {
        starlineList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>Please login to view history.</p>";
        return;
    }

    const starlineQuery = query(
        ref(db, "starline_bids"), 
        orderByChild("userMobile"), 
        equalTo(activeMobile)
    );

    onValue(starlineQuery, (snapshot) => {
        starlineList.innerHTML = "";
        let userBids = [];

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                userBids.push(child.val());
            });
        }

        if (userBids.length === 0) {
            starlineList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>No bids placed yet.</p>";
            return;
        }

        // Newest Bids First
        userBids.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        userBids.forEach(bid => {
            const rawStatus = (bid.status || 'PENDING').toUpperCase();
            
            let statusBg = "#fef3c7";
            let statusTextColor = "#d97706";
            let resultMessage = `<span style="color:#16a34a;">Best Of Luck !</span>`;

            if (rawStatus === "WON" || rawStatus === "WIN") {
                statusBg = "#d1fae5";
                statusTextColor = "#059669";
                resultMessage = `<span style="color:#16a34a;">Congratulation ! You Win</span>`;
            } else if (rawStatus === "LOST" || rawStatus === "LOSS") {
                statusBg = "#fee2e2";
                statusTextColor = "#dc2626";
                resultMessage = `<span style="color:#dc2626;">Better Luck ! Next Time</span>`;
            }

            // Market Title (Direct Starline Name)
            const headerTitle = (bid.marketName || 'STARLINE').toUpperCase();

            // Date and Time Formatting
            let dateStr = "N/A";
            let timeStr = "N/A";
            if (bid.timestamp) {
                const dt = new Date(bid.timestamp);
                dateStr = dt.toLocaleDateString("en-IN", { day: '2-digit', month: '2-digit', year: 'numeric' });
                timeStr = dt.toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit', hour12: true });
            }

            const item = document.createElement("div");
            item.style.cssText = `
                background: #fffbeb;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 10px rgba(0,0,0,0.06);
                margin-bottom: 16px;
                border: 1.5px solid #fcd34d;
                font-family: sans-serif;
            `;

            item.innerHTML = `
                <!-- 1. Header (#ffc107) -->
                <div style="background:#ffc107; color:#1e293b; font-weight:800; text-align:center; padding:10px; font-size:16px; letter-spacing:0.5px;">
                    ${headerTitle}
                </div>

                <div style="padding:14px;">
                    <!-- 2. Status & Win Amount Row -->
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div>
                            <span style="font-size:15px; font-weight:800; color:#374151;">Status : </span>
                            <span style="background:${statusBg}; color:${statusTextColor}; padding:4px 10px; border-radius:6px; font-size:13px; font-weight:800;">${rawStatus}</span>
                        </div>
                        ${(rawStatus === 'WIN' || rawStatus === 'WON') ? `<div style="color:#16a34a; font-weight:800; font-size:16px;">Win: +${bid.winAmount || 0}</div>` : ''}
                    </div>

                    <div style="border-top:1px solid #fde68a; margin-bottom:10px;"></div>

                    <!-- 3. Bid | Point | Type Table -->
                    <div style="display:flex; justify-content:space-between; text-align:center; font-weight:800; color:#4b5563; font-size:15px; margin-bottom:6px;">
                        <span style="flex:1;">Bid</span>
                        <span style="flex:1;">Point</span>
                        <span style="flex:1;">Type</span>
                    </div>

                    <div style="display:flex; justify-content:space-between; text-align:center; font-weight:800; color:#111827; font-size:15px; margin-bottom:12px;">
                        <span style="flex:1;">${bid.bidNumber || '-'}</span>
                        <span style="flex:1;">${bid.points || 0}</span>
                        <span style="flex:1;">${(bid.gameType || 'SINGLE DIGIT').toUpperCase()}</span>
                    </div>

                    <div style="border-top:1px solid #fde68a; margin-bottom:10px;"></div>

                    <!-- 4. Result Message -->
                    <div style="text-align:center; font-size:15px; font-weight:800; margin-bottom:10px;">
                        ${resultMessage}
                    </div>

                    <div style="border-top:1px solid #fde68a; margin-bottom:10px;"></div>

                    <!-- 5. Date & Time Row (Bottom Most) -->
                    <div style="display:flex; justify-content:space-between; font-size:14px; color:#111827; font-weight:800; padding:0 5px;">
                        <span>Date : ${dateStr}</span>
                        <span>Time : ${timeStr}</span>
                    </div>
                </div>
            `;

            starlineList.appendChild(item);
        });
    }, (error) => {
        console.error("Starline Query Error:", error);
        starlineList.innerHTML = "<p style='text-align:center; color:#ef4444; padding:30px; font-weight:600;'>Error loading history.</p>";
    });
}

// Open Starline History Event Fix
window.openStarlineHistory = function() {
    const page = document.getElementById("starlineHistoryPage");
    if (page) {
        page.style.display = "flex";
        loadStarlineHistory();
    }
};

// Close Button Bind
document.addEventListener("DOMContentLoaded", () => {
    const closeBtn = document.getElementById("closeStarlineHistory");
    if (closeBtn) {
        closeBtn.onclick = () => {
            const page = document.getElementById("starlineHistoryPage");
            if (page) page.style.display = "none";
        };
    }
});

// Global Event Listeners Registration
document.addEventListener("DOMContentLoaded", () => {

    // Starline History Button Click Handler
    const historyBtn = document.getElementById("starlineHistoryBtn");
    if (historyBtn) {
        historyBtn.addEventListener("click", () => {
            // Side Menu Reset
            const sideMenu = document.getElementById("sideMenu");
            if (sideMenu) {
                sideMenu.classList.remove("active");
                sideMenu.style.left = "";
            }

            const menuOverlay = document.getElementById("menuOverlay");
            if (menuOverlay) menuOverlay.classList.remove("active");

            // Open History Page
            const historyPage = document.getElementById("starlineHistoryPage");
            if (historyPage) {
                historyPage.style.display = "block";
                loadStarlineHistory();
            }
        });
    }

    // Close History Page Handler
    const closeHistoryBtn = document.getElementById("closeStarlineHistory");
    if (closeHistoryBtn) {
        closeHistoryBtn.addEventListener("click", () => {
            document.getElementById("starlineHistoryPage").style.display = "none";
        });
    }
});

// ==================== STARLINE MODULE COMPLETE (RENDER + RESULT DECLARE) ====================

// ==================== STARLINE PAYOUT & MARKET ENGINE ====================

const STARLINE_WIN_RATES = {
    SINGLE_DIGIT: 10,
    SINGLE_PANA: 160,
    DOUBLE_PANA: 320,
    TRIPLE_PANA: 700,
    CYCLE_PANA: 160, // Default fallback
    SP_MOTOR: 160,
    DP_MOTOR: 320
};

let starlineActiveTargetKey = "";
let starlineActiveTargetName = "";

// --- STARLINE SPECIFIC HELPER FUNCTION (Unique Name to Avoid Duplicate Error) ---
function getStarlinePanaType(panaStr) {
    if (!panaStr || panaStr.length !== 3) return "SINGLE_PANA";
    const uniqueDigits = new Set(panaStr.split('')).size;
    if (uniqueDigits === 2) return "DOUBLE_PANA"; // e.g. 112, 122
    if (uniqueDigits === 1) return "TRIPLE_PANA"; // e.g. 111
    return "SINGLE_PANA"; // e.g. 123
}

// Admin Check
function isStarlineAdmin() {
    const userMobile = localStorage.getItem("userMobile") || (typeof loggedUserMobile !== "undefined" ? loggedUserMobile : "");
    const adminMobiles = ["8799274536", "8799274536"]; 
    return adminMobiles.includes(userMobile) || localStorage.getItem("isAdmin") === "true";
}

// Global scope binding so Play Button works 100%
window.openStarlineBiddingPopup = function(marketName, marketId, timeSlot) {
    currentStarlineMarket = marketName || "STARLINE";

    const titleElem = document.getElementById("starlineMarketTitle");
    if (titleElem) {
        titleElem.innerText = `STARLINE ${currentStarlineMarket}`;
        titleElem.setAttribute("data-market-id", marketId || "");
        titleElem.setAttribute("data-time-slot", timeSlot || "");
    }

    // Reset Forms & Views
    if (typeof resetStarlineBidFormCompletely === "function") {
        resetStarlineBidFormCompletely();
    }
    
    const biddingView = document.getElementById("starlineBiddingView");
    const footer = document.getElementById("starlineSubmitFooter");
    const gamesView = document.getElementById("starlineGamesView");

    if (biddingView) biddingView.style.setProperty("display", "none", "important");
    if (footer) footer.style.setProperty("display", "none", "important");
    if (gamesView) gamesView.style.display = "block";

    // Show Main Bidding Page Container
    const biddingPage = document.getElementById("starlineBiddingPage") || document.getElementById("starlineBidPopup");
    if (biddingPage) {
        biddingPage.style.setProperty("display", "block", "important");
    }
};

// Render Markets List in App
function loadStarlineMarkets() {
    onValue(ref(db, "starline_markets"), (snap) => {
        const container = document.getElementById("starlineMarketsList");
        if (!container) return;
        container.innerHTML = "";

        if (!snap.exists()) {
            container.innerHTML = "<p style='padding:15px; text-align:center; color:#64748b;'>No Starline markets added yet.</p>";
            return;
        }

        const data = snap.val();

        Object.keys(data).forEach(key => {
            const market = data[key];
            const timeStr = market.time || market.marketName || key;
            const result = market.result || "***-*";
            const closed = market.status === "CLOSED" || (typeof isMarketExpired === "function" && isMarketExpired(timeStr));

            let adminBtnHTML = "";
            if (isStarlineAdmin()) {
                adminBtnHTML = `
                    <button class="st-admin-res-btn" data-key="${key}" data-name="${market.marketName || 'STARLINE ' + timeStr}" style="background:#2563eb; color:#ffffff; padding:7px 11px; border:none; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; margin-left:6px;">
                        Result
                    </button>
                `;
            }

            const card = document.createElement("div");
            card.style.cssText = `background:#ffffff; border-radius:10px; padding:12px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border-left:5px solid ${closed ? '#ef4444' : '#10b981'}; box-shadow:0 2px 5px rgba(0,0,0,0.06);`;
            
            card.innerHTML = `
                <div>
                    <div style="font-size:15px; font-weight:700; color:#1e293b;">${market.marketName || 'STARLINE ' + timeStr}</div>
                    <div style="font-size:16px; font-weight:800; color:#059669; margin-top:3px;">${result}</div>
                </div>
                <div style="display:flex; align-items:center; gap:5px;">
                    ${closed 
                        ? `<span style="background:#ef4444; color:#fff; padding:5px 11px; border-radius:12px; font-size:11px; font-weight:bold;">CLOSED</span>` 
                        : `<button class="open-bid-btn" data-time="${timeStr}" style="background:#10b981; color:#fff; padding:7px 13px; border:none; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">PLAY</button>`
                    }
                    ${adminBtnHTML}
                </div>
            `;
            container.appendChild(card);
        });

        // Event Listener for PLAY Button (Fixed Action Trigger)
        document.querySelectorAll(".open-bid-btn").forEach(btn => {
            btn.onclick = (e) => {
                const selectedTime = e.target.getAttribute("data-time");
                window.openStarlineBiddingPopup(selectedTime, "", selectedTime);
            };
        });

        // Event Listener for Result Button
        document.querySelectorAll(".st-admin-res-btn").forEach(btn => {
            btn.onclick = (e) => {
                starlineActiveTargetKey = e.target.getAttribute("data-key");
                starlineActiveTargetName = e.target.getAttribute("data-name");

                const titleElem = document.getElementById("declareModalTitle");
                if (titleElem) titleElem.innerText = `Declare: ${starlineActiveTargetName}`;

                const modal = document.getElementById("starlineDeclareModal");
                if (modal) modal.style.display = "flex";
            };
        });
    });
}

// FAST Dynamic Result Declaration & Instant Parallel Wallet Credit
async function processStarlineResultAndPayout() {
    const panaVal = document.getElementById("appStarlinePanaInput").value.trim();
    const digitVal = document.getElementById("appStarlineDigitInput").value.trim();

    if (!panaVal || panaVal.length !== 3) return alert("3-Digit Pana enter karein!");
    if (digitVal === "" || digitVal < 0 || digitVal > 9) return alert("Valid Single Digit (0-9) enter karein!");

    const fullResult = `${panaVal}-${digitVal}`;

    if (!confirm(`Confirm Result: ${fullResult} for ${starlineActiveTargetName}? Winners ke wallet me points credit ho jayenge.`)) return;

    try {
        // Today Date (YYYY-MM-DD Format)
        const todayDate = new Date().toISOString().split("T")[0];

        // 1. Close Market Immediately & Save History for Calendar Filter
        await update(ref(db, `starline_markets/${starlineActiveTargetKey}`), {
            result: fullResult,
            status: "CLOSED"
        });

        // 🌟 NAYA ADDITION: Calendar Filter ki History me Result Save
        await set(ref(db, `declared_results/${todayDate}/starline/${starlineActiveTargetKey}`), {
            name: starlineActiveTargetName,
            result: fullResult,
            time: starlineActiveTargetName, // Starline me market name hi uska time hota hai (e.g. 10:00 AM)
            date: todayDate
        });

        // 2. Fetch all bids
        const bidsSnap = await get(ref(db, "starline_bids"));
        if (bidsSnap.exists()) {
            const allBids = bidsSnap.val();
            let winnersPaidCount = 0;
            const payoutPromises = []; // High performance async container

            for (let bId in allBids) {
                const b = allBids[bId];

                if (b.marketName === starlineActiveTargetName && b.status === "PENDING") {
                    let isWinningBid = false;
                    let winAmount = 0;

                    const bidNum = String(b.bidNumber).trim();
                    const winPana = String(panaVal).trim();
                    const winDigit = String(digitVal).trim();

                    // Check Winners & Apply Dynamic Multiplier
                    if (b.gameType === "SINGLE_DIGIT" && bidNum === winDigit) {
                        isWinningBid = true;
                        winAmount = b.points * STARLINE_WIN_RATES.SINGLE_DIGIT;
                    } else if (b.gameType === "SINGLE_PANA" && bidNum === winPana) {
                        isWinningBid = true;
                        winAmount = b.points * STARLINE_WIN_RATES.SINGLE_PANA;
                    } else if (b.gameType === "DOUBLE_PANA" && bidNum === winPana) {
                        isWinningBid = true;
                        winAmount = b.points * STARLINE_WIN_RATES.DOUBLE_PANA;
                    } else if (b.gameType === "TRIPLE_PANA" && bidNum === winPana) {
                        isWinningBid = true;
                        winAmount = b.points * STARLINE_WIN_RATES.TRIPLE_PANA;
                    } else if (b.gameType === "CYCLE_PANA" && bidNum === winPana) {
                        isWinningBid = true;
                        // Dynamic Rate Fix for Cycle Pana (SP = 160, DP = 320)
                        const winPanaType = getStarlinePanaType(winPana);
                        const rate = (winPanaType === "DOUBLE_PANA") ? STARLINE_WIN_RATES.DOUBLE_PANA : STARLINE_WIN_RATES.SINGLE_PANA;
                        winAmount = b.points * rate;
                    } else if (b.gameType === "SP_MOTOR" && bidNum === winPana) {
                        isWinningBid = true;
                        winAmount = b.points * STARLINE_WIN_RATES.SP_MOTOR;
                    } else if (b.gameType === "DP_MOTOR" && bidNum === winPana) {
                        isWinningBid = true;
                        winAmount = b.points * STARLINE_WIN_RATES.DP_MOTOR;
                    }

                    // Parallel execution using Promises (Fast Execution)
                    if (isWinningBid) {
                        winnersPaidCount++;
                        const userWalletRef = ref(db, `users/${b.userMobile}/wallet`);
                        
                        payoutPromises.push(
                            runTransaction(userWalletRef, (currBal) => (currBal || 0) + winAmount)
                        );
                        payoutPromises.push(
                            update(ref(db, `starline_bids/${bId}`), { status: "WON", winAmount: winAmount })
                        );
                    } else {
                        payoutPromises.push(
                            update(ref(db, `starline_bids/${bId}`), { status: "LOST" })
                        );
                    }
                }
            }

            // Execute all transactions instantly
            await Promise.all(payoutPromises);
            alert(`Result (${fullResult}) Declared! ${winnersPaidCount} winners automatically paid.`);
        } else {
            alert(`Result (${fullResult}) Declared! No bids found.`);
        }

        // Close Modal & Reset
        const modal = document.getElementById("starlineDeclareModal");
        if (modal) modal.style.display = "none";
        document.getElementById("appStarlinePanaInput").value = "";
        document.getElementById("appStarlineDigitInput").value = "";

    } catch (err) {
        console.error("Starline result error:", err);
        alert("Error: " + err.message);
    }
}

// Global Event Listeners
document.addEventListener("DOMContentLoaded", () => {
    const closeBtn = document.getElementById("closeDeclareModal");
    if (closeBtn) {
        closeBtn.onclick = () => {
            const modal = document.getElementById("starlineDeclareModal");
            if (modal) modal.style.display = "none";
        };
    }

    const submitBtn = document.getElementById("submitStarlineResultBtn");
    if (submitBtn) {
        submitBtn.onclick = processStarlineResultAndPayout;
    }
});

// Database se Notice Text read karna
onValue(ref(db, "app_notice"), (snapshot) => {
    if (snapshot.exists()) {
        document.getElementById("noticeText").innerText = snapshot.val();
    }
});

document.addEventListener("DOMContentLoaded", () => {
  
  // 1. Open / Close Popup Logic
  const regBtn = document.getElementById("registerBtn");
  const regPopup = document.getElementById("registerPopup");
  const closeBtn = document.getElementById("closeRegister");

  if (regBtn && regPopup) {
    regBtn.onclick = (e) => {
      e.preventDefault();
      regPopup.style.display = "flex"; // CSS flex popup ko center karega
    };
  }

  if (closeBtn && regPopup) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      regPopup.style.display = "none";
    };
  }

  // 2. Eye Toggle Logic Function
  const setupEyeToggle = (toggleId, inputId) => {
    const toggle = document.getElementById(toggleId);
    const input = document.getElementById(inputId);
    if (toggle && input) {
      toggle.onclick = () => {
        if (input.type === "password") {
          input.type = "text";
          toggle.textContent = "🙈";
        } else {
          input.type = "password";
          toggle.textContent = "👁️";
        }
      };
    }
  };

  setupEyeToggle("toggleRegPassword", "regPassword");
  setupEyeToggle("toggleConfirmPassword", "confirmPassword");

  // 3. Create Account Submit Logic
  const createBtn = document.getElementById("createAccount");
  if (createBtn) {
    createBtn.onclick = async (e) => {
      e.preventDefault();

      const nameVal = document.getElementById("name")?.value.trim() || "";
      const mobileVal = document.getElementById("regMobile")?.value.trim() || "";
      const passVal = document.getElementById("regPassword")?.value.trim() || "";
      const confirmPassVal = document.getElementById("confirmPassword")?.value.trim() || "";

      if (!nameVal) return alert("Please enter Full Name!");
      if (!mobileVal || mobileVal.length !== 10) return alert("Please enter valid 10-digit Mobile Number!");
      if (!passVal) return alert("Please enter Password!");
      if (passVal !== confirmPassVal) return alert("Passwords do not match!");

      try {
        const userRef = ref(db, `users/${mobileVal}`);
        const snapshot = await get(userRef);

        if (snapshot.exists()) {
          return alert("This Mobile Number is already registered!");
        }

        await set(userRef, {
          createdAt: Date.now(),
          mobile: mobileVal,
          name: nameVal,
          password: passVal,
          wallet: 100
        });

        localStorage.setItem("userMobile", mobileVal);
        localStorage.setItem("mobile", mobileVal);

        // 1. Pehle Register Popup hide karo
        if (regPopup) regPopup.style.display = "none";

        // 2. Apne Custom Success Modal aur Sound ko trigger karo
        if (typeof triggerRegisterSuccess === "function") {
          triggerRegisterSuccess();
        } else {
          // Fallback agar trigger function na mile
          const successModal = document.getElementById("registerSuccessModal");
          if (successModal) successModal.style.setProperty("display", "flex", "important");
          if (typeof playSuccessSound === "function") playSuccessSound();
        }

      } catch (err) {
        console.error("Registration Error:", err);
        alert("Account creation failed: " + err.message);
      }
    };
  }
});

// WHATSAPP REDIRECT LOGIC
const waBtn = document.getElementById("whatsappBtn");
if (waBtn) {
  waBtn.onclick = (e) => {
    e.preventDefault();
    const phone = "918799274536"; // Country code + Mobile
    const message = encodeURIComponent("Hello Admin, I need help with BOSS777 App.");
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank");
  };
}

// Open Game Rate Page from Side Menu
document.getElementById("gameRateMenuBtn")?.addEventListener("click", () => {
    // 1. Close Side Menu & Overlay
    document.getElementById("sideMenu")?.classList.remove("active");
    const overlay = document.getElementById("menuOverlay");
    if (overlay) overlay.style.display = "none";

    // 2. Show Game Rate Page / Modal
    const gameRatePage = document.getElementById("gameRatesScreen"); // Apni Game Rate Page ki exact ID yahan check kar lena
    if (gameRatePage) {
        gameRatePage.style.display = "block";
    }
});

// 1. OPEN PASSBOOK PAGE
document.getElementById("passbookMenuBtn")?.addEventListener("click", function() {
    var sideMenu = document.getElementById("sideMenu");
    if (sideMenu) {
        sideMenu.classList.remove("active");
        sideMenu.style.display = "none";
    }

    var overlay = document.getElementById("menuOverlay");
    if (overlay) overlay.style.display = "none";

    var passbookPage = document.getElementById("passbookFullPage");
    if (passbookPage) {
        passbookPage.style.setProperty("display", "block", "important");
    }

    loadPassbookExactCalculation();
});

// 2. CLOSE PASSBOOK PAGE
document.getElementById("closePassbookPage")?.addEventListener("click", function() {
    var passbookPage = document.getElementById("passbookFullPage");
    if (passbookPage) passbookPage.style.display = "none";
    var sideMenu = document.getElementById("sideMenu");
    if (sideMenu) sideMenu.style.display = "";
});

// 3. EXACT REALTIME PASSBOOK CALCULATION
function loadPassbookExactCalculation() {
    var container = document.getElementById("passbookBidsList");
    if (!container) return;

    var userMob = (typeof currentUserMobile !== "undefined" && currentUserMobile) ? currentUserMobile : "";
    if (!userMob || typeof db === "undefined") {
        container.innerHTML = '<div style="text-align:center; padding:30px; color:#ef4444; font-size:16px; font-weight:bold;">User Logged In Nahi Hai!</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding:30px; color:#666; font-size:16px; font-weight:bold;">Loading History...</div>';

    // A. Fetch Current Realtime Wallet Balance directly from RTDB
    var walletRef = ref(db, `users/${userMob}/wallet`);
    get(walletRef).then(function(walletSnap) {
        var liveWalletBalance = walletSnap.exists() ? parseInt(walletSnap.val()) : 0;
        
        // Fallback to UI balance if node not present
        if (isNaN(liveWalletBalance) || liveWalletBalance === 0) {
            var walletEl = document.getElementById("walletBalance") || document.getElementById("userBalance") || document.getElementById("walletPoints");
            if (walletEl) liveWalletBalance = parseInt(walletEl.innerText.replace(/\D/g, '')) || 0;
        }

        // B. Fetch Main Bids
        get(ref(db, "bids")).then(function(mainSnap) {
            var mainData = mainSnap.val() || {};
            
            // C. Fetch Starline Bids
            get(ref(db, "starline_bids")).then(function(starSnap) {
                var starData = starSnap.val() || {};
                var userBids = [];

                Object.keys(mainData).forEach(function(k) {
                    var item = mainData[k];
                    if (item && item.userMobile === userMob) userBids.push(item);
                });

                Object.keys(starData).forEach(function(k) {
                    var item = starData[k];
                    if (item && item.userMobile === userMob) userBids.push(item);
                });

                if (userBids.length === 0) {
                    container.innerHTML = '<div style="text-align:center; padding:40px; color:#888; font-size:16px; font-weight:bold;">No Bid Entry Found Yet!</div>';
                    return;
                }

                // Oldest to Newest Sort for Step-by-Step Balance Calculation
                userBids.sort(function(a, b) {
                    return (a.timestamp || 0) - (b.timestamp || 0);
                });

                // Compute Initial Starting Balance
                var totalSpentPoints = 0;
                userBids.forEach(function(b) { totalSpentPoints += parseInt(b.points || 0); });
                
                // Starting Points Before Any Bids Placed
                var runningBalance = liveWalletBalance + totalSpentPoints;

                // Process Array
                // Process Array (With Starline Session Check Fix)
var processedBids = [];
userBids.forEach(function(bid) {
    var pts = parseInt(bid.points || 0);
    runningBalance = runningBalance - pts; // Exact subtraction logic

    var rawMarketName = (bid.marketName || bid.gameName || 'MAIN BAZAR').toUpperCase();
    var sessionType = (bid.session || '').toUpperCase();
    
    var titleWithSession = "";

    // STARLINE CHECK: Agar Market Name me STARLINE hai toh OPEN/CLOSE nahi judega
    if (rawMarketName.includes("STARLINE")) {
        titleWithSession = rawMarketName; // e.g. "STARLINE 05:00 PM"
    } else {
        // Normal Main Market me OPEN / CLOSE judega
        var validSession = sessionType ? sessionType : 'OPEN';
        titleWithSession = `${rawMarketName} (${validSession})`;
    }

    processedBids.push({
        gameHeader: titleWithSession,
        digitVal: bid.bidNumber || bid.digit || '---',
        pointsVal: pts,
        gameType: (bid.gameType || 'SINGLE DIGIT').toUpperCase(),
        dateFormatted: bid.timestamp ? new Date(bid.timestamp).toLocaleString("en-IN", {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        }) : 'N/A',
        closingBal: runningBalance,
        rawTime: bid.timestamp || 0
    });
});

                // Latest Bids First
                processedBids.sort(function(a, b) { return b.rawTime - a.rawTime; });

                // Render Cards
                var htmlCards = "";
                processedBids.forEach(function(bid) {
                    htmlCards += `
                        <div style="background:#fde8e8; border-radius:12px; overflow:hidden; border:1.5px solid #f87171; box-shadow:0 4px 8px rgba(0,0,0,0.05); font-family:sans-serif;">
                            
                            <!-- Dark Red Header -->
                            <div style="background:#991b1b; color:#ffffff; font-weight:800; text-align:center; padding:10px; font-size:16px; letter-spacing:0.5px;">
                                ${bid.gameHeader}
                            </div>

                            <div style="padding:14px 16px;">
                                <!-- Table Header Row -->
                                <div style="display:flex; justify-content:space-between; text-align:center; font-weight:800; color:#374151; font-size:15px; border-bottom:1.5px solid #fca5a5; padding-bottom:6px;">
                                    <span style="flex:1;">BID</span>
                                    <span style="flex:1;">POINT</span>
                                    <span style="flex:1;">TYPE</span>
                                </div>

                                <!-- Table Values Row -->
                                <div style="display:flex; justify-content:space-between; text-align:center; font-weight:800; color:#111827; font-size:15px; margin:10px 0;">
                                    <span style="flex:1;">${bid.digitVal}</span>
                                    <span style="flex:1;">${bid.pointsVal}</span>
                                    <span style="flex:1;">${bid.gameType}</span>
                                </div>

                                <!-- Date & Time Line (Bolder Black Box Line) -->
                                <div style="text-align:center; background:#fee2e2; border:1px solid #fca5a5; padding:6px; border-radius:6px; font-size:15px; color:#111827; font-weight:800; margin-bottom:10px;">
                                    DATE : ${bid.dateFormatted}
                                </div>

                                <!-- Debit Red & Closing Balance Green Row -->
                                <div style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; padding:8px 12px; border-radius:8px; font-size:15px; font-weight:800; border:1.5px solid #fca5a5;">
                                    <span style="color:#dc2626;">Debit : - ${bid.pointsVal}</span>
                                    <span style="color:#16a34a;">Closing Balance : ${bid.closingBal}</span>
                                </div>
                            </div>
                        </div>
                    `;
                });

                container.innerHTML = htmlCards;
            });
        });
    });
}

// ==========================================
// NAVIGATION & DEDICATED HISTORIES CONTROLLER
// ==========================================

// 1. Home Direct Back Control
window.goHomeDirect = function() {
    ["bidsSubPage", "fullHistoryPage", "starlineBidsFullPage", "passbookFullPage", "rechargePopup", "withdrawPopup"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
    
    document.querySelectorAll(".bottom-nav .nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById("navHomeBtn")?.classList.add("active");

    document.body.classList.remove("hide-bottom-nav");
};

// 2. Bids Sub-Page Opener & Closer
window.openBidsPage = function() {
    const bidsPage = document.getElementById("bidsSubPage");
    if (bidsPage) bidsPage.style.display = "block";
    
    document.body.classList.add("hide-bottom-nav");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById("navBidsBtn")?.classList.add("active");
};

window.closeBidsSubPage = function() {
    const bidsPage = document.getElementById("bidsSubPage");
    if (bidsPage) bidsPage.style.display = "none";
    window.goHomeDirect();
};

// 3. Close Dedicated History Screens
window.closeFullHistoryPage = function() {
    const fullPage = document.getElementById("fullHistoryPage");
    if (fullPage) fullPage.style.display = "none";
};

window.closeStarlineBidsPage = function() {
    const starlineBidsPage = document.getElementById("starlineBidsFullPage");
    if (starlineBidsPage) starlineBidsPage.style.display = "none";
};

// 4. Smart Trigger Function (Independent Containers)
window.triggerBidsFilter = function(mode) {
    const fullPage = document.getElementById("fullHistoryPage");
    const starlineBidsPage = document.getElementById("starlineBidsFullPage");
    const mainList = document.getElementById("fullHistoryList");
    const starlineContent = document.getElementById("starlineBidsContentList");

    // Close both history screens first
    if (fullPage) fullPage.style.display = "none";
    if (starlineBidsPage) starlineBidsPage.style.display = "none";

    document.body.classList.add("hide-bottom-nav");

    // --- STARLINE MARKETS (INDEPENDENT CONTAINER) ---
    if (mode.startsWith('STARLINE')) {
        if (!starlineBidsPage || !starlineContent) return;

        const titleEl = document.getElementById("starlineBidsTitle");
        if (titleEl) {
            titleEl.innerText = (mode === 'STARLINE_WIN') ? "Starline Win History" : "Starline Bid History";
        }

        starlineContent.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:700;'>Loading Starline History...</p>";
        starlineBidsPage.style.display = "block";

        // Fetch Data from original function
        if (typeof loadStarlineHistory === "function") {
            loadStarlineHistory();
        }

        // Copy rendered data from original starline div to our dedicated container
        setTimeout(() => {
            const originalStarlineList = document.getElementById("starlineHistoryList");
            if (!originalStarlineList || originalStarlineList.children.length === 0) {
                starlineContent.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>No Starline Bids Found.</p>";
                return;
            }

            starlineContent.innerHTML = "";
            const cards = Array.from(originalStarlineList.children);
            let count = 0;

            cards.forEach(card => {
                const clone = card.cloneNode(true);
                const txt = clone.innerText.toUpperCase();
                const isWin = txt.includes("WIN") || txt.includes("WON") || txt.includes("CONGRAT");

                let show = false;
                if (mode === 'STARLINE_ALL') show = true;
                else if (mode === 'STARLINE_WIN') show = isWin;

                if (show) {
                    clone.style.display = "block";
                    starlineContent.appendChild(clone);
                    count++;
                }
            });

            if (count === 0) {
                starlineContent.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>No records found.</p>";
            }
        }, 500);
    } 
    // --- MAIN MARKETS ---
    else {
        if (!fullPage || !mainList) return;

        const titleEl = document.getElementById("fullHistoryTitle");
        if (titleEl) {
            titleEl.innerText = (mode === 'MAIN_WIN') ? "Main Markets Win History" : "Main Markets Bid History";
        }

        mainList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:700;'>Loading Main History...</p>";
        fullPage.style.display = "block";

        if (typeof loadBidsHistory === "function") {
            loadBidsHistory();
        }

        setTimeout(() => {
            const originalBidsList = document.getElementById("bidsList");
            if (!originalBidsList || originalBidsList.children.length === 0) {
                mainList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>No bids found.</p>";
                return;
            }

            mainList.innerHTML = "";
            const cards = Array.from(originalBidsList.children);
            let count = 0;

            cards.forEach(card => {
                const clone = card.cloneNode(true);
                const txt = clone.innerText.toUpperCase();
                const isStarline = txt.includes("STARLINE");
                const isWin = txt.includes("WIN") || txt.includes("WON") || txt.includes("CONGRAT");

                let show = false;
                if (mode === 'MAIN_ALL') show = !isStarline;
                else if (mode === 'MAIN_WIN') show = !isStarline && isWin;

                if (show) {
                    clone.style.display = "block";
                    mainList.appendChild(clone);
                    count++;
                }
            });

            if (count === 0) {
                mainList.innerHTML = "<p style='text-align:center; color:#94a3b8; padding:30px; font-weight:600;'>No records found.</p>";
            }
        }, 400);
    }
};

// 5. Auth Form Detection & Navigation Auto-Hide
// 5. BULLETPROOF NAVIGATION DISPLAY CONTROLLER
setInterval(() => {
    // 1. Helper to check if any active overlay/modal/side-page exists
    const isOverlayActive = () => {
        // Check for common overlay classes in modern hybrid apps
        const activeElements = document.querySelectorAll(
            '.modal.show, .modal.active, .popup.show, .popup.active, ' +
            '.overlay.show, .overlay.active, .sub-page.active, .sub-page.show, ' +
            '.drawer.open, .drawer.active, .side-menu.active, .side-menu.open, ' +
            '#sideMenu.active, #sideMenu.open, .sidebar.open'
        );
        
        for (let el of activeElements) {
            const style = window.getComputedStyle(el);
            if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
                return true;
            }
        }
        return false;
    };

    // 2. Helper to check specific IDs by computed style
    const isElementVisible = (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && el.offsetHeight > 0;
    };

    // Direct ID checks for Splash, Login, Register, Sub-Pages & Starline Views
    const isSplash = isElementVisible("splash") || isElementVisible("splashScreen");
    const isLogin = isElementVisible("login") || isElementVisible("loginScreen") || isElementVisible("loginForm");
    const isRegister = isElementVisible("registerPopup") || isElementVisible("registerPage");
    
    // Sub-Pages & Modals
    const isPassbook = isElementVisible("passbookFullPage");
    const isBids = isElementVisible("bidsSubPage");
    const isFunds = isElementVisible("fundsSubPage");
    const isFullHist = isElementVisible("fullHistoryPage");
    
    // Check if Starline view/modal or subscreen is currently displayed
    const starlineEl = document.getElementById("starlineBidsFullPage") || 
                       document.getElementById("starlineHistoryPage") || 
                       document.getElementById("starlineModal") || 
                       document.getElementById("starlinePage");
    const isStarlineOpen = starlineEl ? isElementVisible(starlineEl.id) : false;

    // Check if body has menu-open class
    const isBodyMenuOpen = document.body.classList.contains("menu-open") || document.body.classList.contains("modal-open");

    // Master Condition
    const shouldHide = isSplash || isLogin || isRegister || isPassbook || 
                       isBids || isFunds || isFullHist || isStarlineOpen || 
                       isBodyMenuOpen || isOverlayActive();

    if (shouldHide) {
        document.body.classList.remove("show-bottom-nav");
        document.body.classList.add("hide-bottom-nav");
    } else {
        document.body.classList.remove("hide-bottom-nav");
        document.body.classList.add("show-bottom-nav");
    }
}, 50);

// State Trackers
window.currentOrigin = 'HOME'; // Options: 'HOME', 'FUNDS', 'BIDS'

window.closeAllOverlays = function() {
    const ids = [
        "bidsSubPage", "fundsSubPage", "fullHistoryPage", "starlineBidsFullPage", 
        "withdrawPopup", "withdrawNoticeModal", "rechargePopup", "rechargePage", 
        "rechargeStep2Page", "upiPaymentPage", "enterAmountPage", "historyPopup"
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
};

// 1. Navigation Commands
window.openFundsPage = function() {
    window.closeAllOverlays();
    const fundsPage = document.getElementById("fundsSubPage");
    if (fundsPage) fundsPage.style.display = "block";
    
    document.body.classList.add("hide-bottom-nav");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById("navFundsBtn")?.classList.add("active");
};

window.openBidsPage = function() {
    window.closeAllOverlays();
    const bidsPage = document.getElementById("bidsSubPage");
    if (bidsPage) bidsPage.style.display = "block";

    document.body.classList.add("hide-bottom-nav");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById("navBidsBtn")?.classList.add("active");
};

window.goHomeDirect = function() {
    window.closeAllOverlays();
    document.body.classList.remove("hide-bottom-nav");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById("navHomeBtn")?.classList.add("active");
};

// Smart Back Handler based on Origin
window.handleSmartBack = function(currentPopupId) {
    const popup = document.getElementById(currentPopupId);
    if (popup) popup.style.display = "none";

    if (window.currentOrigin === 'FUNDS') {
        const fundsPage = document.getElementById("fundsSubPage");
        if (fundsPage) fundsPage.style.display = "block";
    } else if (window.currentOrigin === 'BIDS') {
        const bidsPage = document.getElementById("bidsSubPage");
        if (bidsPage) bidsPage.style.display = "block";
    } else {
        window.goHomeDirect();
    }
};

// 2. Recharge Flow
window.openRechargeFromFunds = function(origin = 'HOME') {
    window.currentOrigin = origin; // Sets origin cleanly ('FUNDS' or 'HOME')

    const step1Page = document.getElementById("rechargePopup") || document.getElementById("rechargePage") || document.getElementById("enterAmountPage");
    const step2Page = document.getElementById("rechargeStep2Page") || document.getElementById("upiPaymentPage");

    window.closeAllOverlays();

    if (step1Page) {
        step1Page.style.display = "block";

        const step1BackBtn = step1Page.querySelector(".back-btn, .history-back-btn, #closeRecharge");
        if (step1BackBtn) {
            step1BackBtn.onclick = function(e) {
                e.preventDefault();
                window.handleSmartBack(step1Page.id);
            };
        }
    }
};

window.goToRechargeStep2 = function() {
    const step1Page = document.getElementById("rechargePopup") || document.getElementById("rechargePage") || document.getElementById("enterAmountPage");
    const step2Page = document.getElementById("rechargeStep2Page") || document.getElementById("upiPaymentPage");

    if (step1Page) step1Page.style.display = "none";
    if (step2Page) {
        step2Page.style.display = "block";

        const step2BackBtn = step2Page.querySelector(".back-btn, .history-back-btn, #closeStep2");
        if (step2BackBtn) {
            step2BackBtn.onclick = function(e) {
                e.preventDefault();
                step2Page.style.display = "none";
                if (step1Page) step1Page.style.display = "block";
            };
        }
    }
};

// 3. Withdraw Flow
window.openWithdrawFromFunds = function(origin = 'HOME') {
    window.currentOrigin = origin; // Sets origin cleanly ('FUNDS' or 'HOME')

    const noticeModal = document.getElementById("withdrawNoticeModal");
    const withdrawPopup = document.getElementById("withdrawPopup");

    window.closeAllOverlays();

    if (noticeModal) {
        noticeModal.style.display = "flex";

        const closeNoticeBtn = document.getElementById("closeWithdrawNotice") || noticeModal.querySelector("button");
        if (closeNoticeBtn) {
            closeNoticeBtn.onclick = function(e) {
                e.preventDefault();
                noticeModal.style.display = "none";
                if (withdrawPopup) withdrawPopup.style.display = "block";
            };
        }
    } else if (withdrawPopup) {
        withdrawPopup.style.display = "block";
    }

    if (withdrawPopup) {
        const closeWithdrawBtn = withdrawPopup.querySelector(".back-btn, .history-back-btn, #closeWithdraw");
        if (closeWithdrawBtn) {
            closeWithdrawBtn.onclick = function(e) {
                e.preventDefault();
                window.handleSmartBack(withdrawPopup.id);
            };
        }
    }
};

// 4. Clean History Loader
window.openCleanHistoryView = function(type, origin = 'HOME') {
    window.currentOrigin = origin; // Sets origin cleanly ('FUNDS', 'BIDS', or 'HOME')

    window.closeAllOverlays();

    const fullPage = document.getElementById("fullHistoryPage");
    const mainList = document.getElementById("fullHistoryList");
    const titleEl = document.getElementById("fullHistoryTitle");

    if (!fullPage || !mainList) return;

    if (type === 'BIDS') {
        if (titleEl) titleEl.innerText = "Bid History";
        fetchAndRenderHistory('bidsList', mainList, 'BIDS');
    } else if (type === 'RECHARGE') {
        if (titleEl) titleEl.innerText = "Recharge History";
        fetchAndRenderHistory('rechargeList', mainList, 'RECHARGE');
    } else if (type === 'WITHDRAW') {
        if (titleEl) titleEl.innerText = "Withdrawal History";
        fetchAndRenderHistory('withdrawList', mainList, 'WITHDRAW');
    }

    fullPage.style.display = "block";
};

function fetchAndRenderHistory(sourceId, targetContainer, type) {
    targetContainer.innerHTML = "<p style='text-align:center; color:#881337; padding:30px; font-weight:700;'>Loading Records...</p>";

    if (type === 'RECHARGE' && typeof loadRechargeHistory === "function") loadRechargeHistory();
    if (type === 'WITHDRAW' && typeof loadWithdrawHistory === "function") loadWithdrawHistory();
    if (type === 'BIDS' && typeof loadBidHistory === "function") loadBidHistory();

    setTimeout(() => {
        const sourceList = document.getElementById(sourceId);

        if (!sourceList || sourceList.children.length === 0 || sourceList.innerText.includes("No ")) {
            targetContainer.innerHTML = `<p style='text-align:center; color:#881337; padding:40px; font-weight:600;'>No ${type.toLowerCase()} records found.</p>`;
            return;
        }

        // Exact original side borders & cards rendering
        targetContainer.innerHTML = sourceList.innerHTML;
    }, 400);
}

window.closeFullHistoryPage = function() {
    window.handleSmartBack("fullHistoryPage");
};

// Funds Page Back Button Handler Fix
window.closeFundsSubPage = function() {
    window.closeAllOverlays();
    
    // Funds Page hide karo
    const fundsPage = document.getElementById("fundsSubPage");
    if (fundsPage) fundsPage.style.display = "none";
    
    // Bottom Nav Reset karke Home active karo
    document.body.classList.remove("hide-bottom-nav");
    document.querySelectorAll(".bottom-nav .nav-item").forEach(el => el.classList.remove("active"));
    document.getElementById("navHomeBtn")?.classList.add("active");
};

window.closeFullHistoryPage = function() {
    const fullPage = document.getElementById("fullHistoryPage");
    if (fullPage) fullPage.style.display = "none";

    // Agar user Bids se aaya tha toh wapas Bids screen hi kholega
    if (window.currentOrigin === 'BIDS') {
        const bidsPage = document.getElementById("bidsSubPage");
        if (bidsPage) bidsPage.style.display = "block";
    } else if (window.currentOrigin === 'FUNDS') {
        const fundsPage = document.getElementById("fundsSubPage");
        if (fundsPage) fundsPage.style.display = "block";
    } else {
        window.goHomeDirect();
    }
};



// 1. DYNAMIC AUDIO GENERATOR (NO EXTERNAL MP3 NEEDED)
function playSuccessSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Play Dual Tone Success Chime
        const playTone = (freq, type, startTime, duration) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime + startTime);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startTime + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(audioCtx.currentTime + startTime);
            osc.stop(audioCtx.currentTime + startTime + duration);
        };

        // Two harmonized notes (E5 -> B5 High Tone)
        playTone(659.25, 'sine', 0, 0.2); 
        playTone(987.77, 'sine', 0.12, 0.35);
    } catch (e) {
        console.log("Audio Context Error: ", e);
    }
}

// 2. SHOW SUCCESS MODAL WITH SOUND
function triggerRegisterSuccess() {
    const successModal = document.getElementById("registerSuccessModal");
    if (successModal) {
        successModal.style.setProperty("display", "flex", "important");
        playSuccessSound(); // Play Audio Sound
    }
}

// 3. CLOSE SUCCESS MODAL & SWITCH TO LOGIN
document.addEventListener("DOMContentLoaded", () => {
    const successContinueBtn = document.getElementById("successContinueBtn");
    if (successContinueBtn) {
        successContinueBtn.addEventListener("click", () => {
            const successModal = document.getElementById("registerSuccessModal");
            if (successModal) {
                successModal.style.setProperty("display", "none", "important");
            }
            // Switch tab to Login Automatically
            if (typeof switchAuthTab === "function") {
                switchAuthTab("login");
            }
        });
    }
});

// =========================================================
// BOSS777 ADVANCED DYNAMIC AUDIO ENGINE (WEB AUDIO API)
// =========================================================

const AudioEngine = {
    // Helper to create smooth custom frequencies
    playNote: (freq, type, startTime, duration, vol = 0.15) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type; // 'sine', 'triangle', 'square'
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
            
            gain.gain.setValueAtTime(vol, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(ctx.currentTime + startTime);
            osc.stop(ctx.currentTime + startTime + duration);
        } catch (e) {
            console.log("Audio API Blocked or Not Supported");
        }
    },

    // 1. BID PLACED SOUND (Fast Game Chip Counter Click & Ping)
    playBidSound: () => {
        AudioEngine.playNote(523.25, 'triangle', 0, 0.08, 0.2);   // C5 Chip Tap
        AudioEngine.playNote(659.25, 'sine', 0.08, 0.12, 0.18);   // E5
        AudioEngine.playNote(1046.50, 'sine', 0.18, 0.3, 0.25);   // C6 High Bell
    },

    // 2. RECHARGE / PAYMENT SUCCESS (Coins Cash Register Sound)
    playRechargeSound: () => {
        AudioEngine.playNote(987.77, 'sine', 0, 0.1, 0.2);        // B5
        AudioEngine.playNote(1318.51, 'sine', 0.08, 0.12, 0.22);  // E6
        AudioEngine.playNote(1760.00, 'triangle', 0.16, 0.4, 0.25); // A6 Coin Cash Drop
    },

    // 3. WITHDRAWAL SUBMITTED SOUND (Celebratory High Fanfare)
    playWithdrawSound: () => {
        AudioEngine.playNote(523.25, 'sine', 0, 0.12, 0.18);      // C5
        AudioEngine.playNote(659.25, 'sine', 0.1, 0.12, 0.2);     // E5
        AudioEngine.playNote(783.99, 'sine', 0.2, 0.15, 0.22);    // G5
        AudioEngine.playNote(1046.50, 'sine', 0.32, 0.5, 0.3);    // C6 Grand Fanfare
    }
};

// =========================================================
// AUTOMATIC POPUP OBSERVERS & EVENT LISTENERS
// =========================================================

// Function to attach audio triggers whenever popups open
document.addEventListener("DOMContentLoaded", () => {

    // 1. Matka Bid Success Popup Monitor
    const matkaSuccess = document.getElementById("matkaSuccessPopup");
    if (matkaSuccess) {
        const observer = new MutationObserver(() => {
            if (matkaSuccess.style.display !== "none" && matkaSuccess.style.display !== "") {
                AudioEngine.playBidSound();
            }
        });
        observer.observe(matkaSuccess, { attributes: true, attributeFilter: ["style"] });
    }

    // 2. Recharge Success Modal Monitor
    const rechargeModal = document.getElementById("rechargeSuccessModal");
    if (rechargeModal) {
        const observer = new MutationObserver(() => {
            if (rechargeModal.style.display !== "none" && rechargeModal.style.display !== "") {
                AudioEngine.playRechargeSound();
            }
        });
        observer.observe(rechargeModal, { attributes: true, attributeFilter: ["style"] });
    }

    // 3. Withdraw Success Modal Monitor
    const withdrawModal = document.getElementById("withdrawSuccessModal");
    if (withdrawModal) {
        const observer = new MutationObserver(() => {
            if (withdrawModal.style.display !== "none" && withdrawModal.style.display !== "") {
                AudioEngine.playWithdrawSound();
            }
        });
        observer.observe(withdrawModal, { attributes: true, attributeFilter: ["style"] });
    }
});

// =========================================================
// ADD STARLINE BID SOUND TO AUDIO ENGINE
// =========================================================

// AudioEngine me ye new method add kar lo:
AudioEngine.playStarlineSound = () => {
    AudioEngine.playNote(783.99, 'sine', 0, 0.08, 0.2);     // G5
    AudioEngine.playNote(1046.50, 'sine', 0.08, 0.1, 0.22);  // C6 Starline Arcade Echo
    AudioEngine.playNote(1318.51, 'triangle', 0.16, 0.25, 0.25); // E6 High Cosmic Tone
};


// DOM Observer listener me Starline Popup ka logic add kar do:
document.addEventListener("DOMContentLoaded", () => {

    // Existing Monitors... (Bid, Recharge, Withdraw)

    // 4. Starline Success Popup Monitor
    const starlineSuccess = document.getElementById("starlineSuccessPopup");
    if (starlineSuccess) {
        const observer = new MutationObserver(() => {
            if (starlineSuccess.style.display !== "none" && starlineSuccess.style.display !== "") {
                AudioEngine.playStarlineSound();
            }
        });
        observer.observe(starlineSuccess, { attributes: true, attributeFilter: ["style"] });
    }
});

// Global Tab State Variable
let currentResultTab = 'main';

// 1. Tab Switch Function
function switchResultTab(tabType) {
  currentResultTab = tabType;
  const tabMain = document.getElementById("tabMainMarket");
  const tabStar = document.getElementById("tabStarline");
  const secMain = document.getElementById("resMainMarketSection");
  const secStar = document.getElementById("resStarlineSection");

  if (!tabMain || !tabStar || !secMain || !secStar) return;

  if (tabType === 'main') {
    tabMain.classList.add("active");
    tabStar.classList.remove("active");
    secMain.classList.add("active");
    secStar.classList.remove("active");
  } else {
    tabStar.classList.add("active");
    tabMain.classList.remove("active");
    secStar.classList.add("active");
    secMain.classList.remove("active");
  }
}

// 2. Tab Event Listeners
document.getElementById("tabMainMarket")?.addEventListener("click", () => {
  switchResultTab('main');
});

document.getElementById("tabStarline")?.addEventListener("click", () => {
  switchResultTab('starline');
});

// 3. Sidemenu Button Click (Full Page Show)
document.getElementById("declaredResultsMenuBtn")?.addEventListener("click", () => {
  const sidebar = document.getElementById("sideMenuDrawer") || document.querySelector(".sidebar");
  if (sidebar) sidebar.classList.remove("active");

  const page = document.getElementById("declaredResultsPage");
  if (page) page.classList.remove("res-page-hidden");

  const dateInput = document.getElementById("resDateInput");
  const today = new Date().toISOString().split("T")[0];
  if (dateInput) dateInput.value = today;

  switchResultTab('main'); // Open Main Markets Tab by default
  loadDeclaredResults(today);
});

// 4. Back Button Handler
document.getElementById("resBackBtn")?.addEventListener("click", () => {
  document.getElementById("declaredResultsPage")?.classList.add("res-page-hidden");
});

// 5. Date Picker Change Event Listener
document.getElementById("resDateInput")?.addEventListener("change", (e) => {
  const selectedDate = e.target.value;
  if (selectedDate) {
    loadDeclaredResults(selectedDate);
  }
});

// 6. Main Data Fetching & Fallback Logic
async function loadDeclaredResults(selectedDate) {
  const mainList = document.getElementById("resMainMarketList");
  const starlineList = document.getElementById("resStarlineList");

  if (!mainList || !starlineList) return;

  mainList.innerHTML = `<p style="text-align:center; color:#64748b; padding:10px;">Loading...</p>`;
  starlineList.innerHTML = `<p style="text-align:center; color:#64748b; padding:10px;">Loading...</p>`;

  try {
    // Single History Fetch
    const historySnap = await get(ref(db, `declared_results/${selectedDate}`));
    const historyData = historySnap.exists() ? historySnap.val() : {};

    const mainHistory = historyData.mainMarket || {};
    const starlineHistory = historyData.starline || {};

    // Fetch Master Markets separately to avoid Promise failure
    let masterMainMarkets = {};
    let masterStarlineMarkets = {};

    try {
      const masterMainSnap = await get(ref(db, 'markets'));
      if (masterMainSnap.exists()) masterMainMarkets = masterMainSnap.val();
    } catch (e) { console.warn("Markets node error:", e); }

    try {
      const masterStarlineSnap = await get(ref(db, 'starline_markets'));
      if (masterStarlineSnap.exists()) masterStarlineMarkets = masterStarlineSnap.val();
    } catch (e) { console.warn("Starline node error:", e); }

    // --- MAIN MARKETS ---
    const allMainKeys = Array.from(new Set([
      ...Object.keys(masterMainMarkets || {}), 
      ...Object.keys(mainHistory || {})
    ]));

    const finalMainList = allMainKeys.map(key => {
      const historyItem = mainHistory[key] || {};
      const masterItem = masterMainMarkets[key] || {};

      let cleanName = historyItem.marketName || historyItem.name 
                      || masterItem.name || masterItem.market_name 
                      || key.replace(/^[0-9]+_/, '').replace(/_/g, ' ').toUpperCase();

      let resultVal = "***-**-***";

      if (historyItem.result && String(historyItem.result).trim() !== "") {
        resultVal = historyItem.result;
      } else if (historyItem.openPanna || historyItem.openDigit) {
        const op = historyItem.openPanna || "***";
        const od = historyItem.openDigit || "*";
        const cd = historyItem.closeDigit || "*";
        const cp = historyItem.closePanna || "***";
        resultVal = `${op}-${od}${cd}-${cp}`;
      }

      return { name: cleanName, result: resultVal };
    });

    // --- STARLINE MARKETS ---
    const allStarlineKeys = Array.from(new Set([
      ...Object.keys(masterStarlineMarkets || {}), 
      ...Object.keys(starlineHistory || {})
    ]));

    const finalStarlineList = allStarlineKeys.map(key => {
      const historyItem = starlineHistory[key] || {};
      const masterItem = masterStarlineMarkets[key] || {};

      let cleanName = historyItem.marketName || historyItem.name 
                      || masterItem.name || masterItem.time || masterItem.market_name 
                      || key.replace(/^[0-9]+_/, '').replace(/_/g, ' ').toUpperCase();

      let resultVal = "***-*";

      if (historyItem.result && String(historyItem.result).trim() !== "") {
        resultVal = historyItem.result;
      } else if (historyItem.panna || historyItem.digit) {
        const p = historyItem.panna || "***";
        const d = historyItem.digit || "*";
        resultVal = `${p}-${d}`;
      }

      return { name: cleanName, result: resultVal };
    });

    // Render Cards
    renderResultCards(mainList, finalMainList, "***-**-***");
    renderResultCards(starlineList, finalStarlineList, "***-*");

  } catch (err) {
    console.error("Result Fetch Main Error:", err);
    mainList.innerHTML = `<p style="text-align:center; color:#ef4444; padding:10px;">Error Loading Data</p>`;
    starlineList.innerHTML = `<p style="text-align:center; color:#ef4444; padding:10px;">Error Loading Data</p>`;
  }
}

// 7. Dynamic Card Renderer (Pure Name and Result Only)
function renderResultCards(container, items, defaultResult = "***-**-***") {
  if (!container) return;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#94a3b8; padding:10px;">No Markets Found</p>`;
    return;
  }

  const cardsHtml = items
    .filter(item => item && typeof item === 'object') // Filter out invalid items
    .map(item => {
      const name = item.name || "MARKET";
      const result = item.result || defaultResult;
      
      return `
        <div class="res-card">
          <span class="res-market-name">${name}</span>
          <span class="res-market-result">${result}</span>
        </div>
      `;
    })
    .join('');

  container.innerHTML = cardsHtml || `<p style="text-align:center; color:#94a3b8; padding:10px;">No Markets Found</p>`;
}