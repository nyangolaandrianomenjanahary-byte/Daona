        // =========== DATA STRUCTURE ============
        const STORAGE_KEY = 'kanban-data';
        const ARCHIVE_KEY = 'kanban-archive';
        const DATA_VERSION = 5;

        
        // ============================================================
        //  SAFE UTILITIES — Error boundaries & data protection
        // ============================================================

        function safeLocalStorageGet(key) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (parsed === null || parsed === undefined) return null;
                return parsed;
            } catch (error) {
                console.error('Corrupted data in ' + key + ':', error);
                try {
                    localStorage.removeItem(key + '_corrupt_backup');
                    localStorage.setItem(key + '_corrupt_backup', localStorage.getItem(key));
                } catch (_) {}
                localStorage.removeItem(key);
                showToast('Donnees corrompues detectees');
                return null;
            }
        }

        function safeLocalStorageSet(key, value) {
            try {
                const serialized = JSON.stringify(value);
                JSON.parse(serialized);
                localStorage.setItem(key, serialized);
                return true;
            } catch (error) {
                console.error('Write error for ' + key + ':', error);
                if (error.name === 'QuotaExceededError') {
                    showToast('Stockage plein');
                }
                return false;
            }
        }

        function safeJsonParse(str, defaultVal) {
            try {
                return JSON.parse(str);
            } catch (e) {
                console.error('JSON parse error:', e);
                return defaultVal;
            }
        }

        function recoverFromError() {
            try {
                const backup = localStorage.getItem(STORAGE_KEY);
                if (backup) localStorage.setItem(STORAGE_KEY + '_emergency_backup', backup);
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(ARCHIVE_KEY);
            } catch (_) {}
            const banner = document.getElementById('error-banner');
            if (banner) banner.classList.remove('visible');
            location.reload();
        }

        window.addEventListener('error', function(event) {
            console.error('Global error:', event.error);
            if (event.error) {
                var msg = event.error.message || 'Inconnue';
                var banner = document.getElementById('error-banner');
                if (banner) {
                    document.getElementById('error-banner-text').textContent = 'Erreur: ' + msg;
                    banner.classList.add('visible');
                }
            }
        });

        window.addEventListener('unhandledrejection', function(event) {
            console.error('Unhandled promise:', event.reason);
        });

        // SortableJS availability
        var sortableAvailable = (typeof Sortable !== 'undefined');
        if (!sortableAvailable) {
            console.warn('SortableJS not loaded');
        }

        function createSortable(el, opts) {
            if (sortableAvailable) {
                return createSortable(el, opts);
            }
            return null;
        }

        // ============================================================

let currentView = 'board';
        let currentCalendarDate = new Date();
        let currentDayDate = new Date();
        const DAY_HOUR_HEIGHT = 64;
        const DAY_START_HOUR = 0;
        const DAY_END_HOUR = 23;

        let state = {
            columns: [],
            cards: [],
            nextColumnId: 1,
            nextCardId: 1
        };

        let archive = [];
        let priorityLabels = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };

        // =========== ICONS (inline SVG) ============
        const icons = {
            calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
            clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
            timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="9"/><path d="M12 8v5l3 2M12 2v2"/></svg>',
            alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
            checklist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
            note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>'
        };

        // =========== TIMER SYSTEM ============
        let activeTimers = {};
        let timerIntervals = {};

        function startTimer(cardId, event) {
            if (event) event.stopPropagation();
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const col = state.columns.find(c => c.id === card.columnId);
            if (isCompletedColumn(col)) {
                showToast('Impossible de démarrer un chronomètre sur une tâche terminée');
                return;
            }
            if (!card.timeHistory) card.timeHistory = [];
            if (!card.totalTimeSpent) card.totalTimeSpent = 0;

            if (activeTimers[cardId]) {
                activeTimers[cardId].startTime = Date.now();
            } else {
                activeTimers[cardId] = { startTime: Date.now(), elapsed: 0 };
            }

            card.timeHistory.push({ type: 'play', timestamp: new Date().toISOString() });

            if (timerIntervals[cardId]) clearInterval(timerIntervals[cardId]);
            timerIntervals[cardId] = setInterval(() => updateTimerDisplay(cardId), 1000);

            saveState();
            _skipEntranceAnimation = true;
            renderBoard();
            updateGlobalTimerBar();
            showToast('Chronomètre démarré');
        }

        function pauseTimer(cardId, event) {
            if (event) event.stopPropagation();
            const card = state.cards.find(c => c.id === cardId);
            if (!card || !activeTimers[cardId]) return;

            const now = Date.now();
            const sessionSeconds = Math.floor((now - activeTimers[cardId].startTime) / 1000);
            activeTimers[cardId].elapsed += sessionSeconds;

            card.timeHistory.push({ type: 'pause', timestamp: new Date().toISOString(), duration: sessionSeconds });
            card.totalTimeSpent += sessionSeconds;

            if (timerIntervals[cardId]) {
                clearInterval(timerIntervals[cardId]);
                delete timerIntervals[cardId];
            }
            activeTimers[cardId].startTime = null;

            saveState();
            _skipEntranceAnimation = true;
            renderBoard();
            updateGlobalTimerBar();
            showToast('Chronomètre en pause');
        }

        function stopTimer(cardId, event) {
            if (event) event.stopPropagation();
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;

            let sessionSeconds = 0;
            if (activeTimers[cardId]) {
                if (activeTimers[cardId].startTime) {
                    const now = Date.now();
                    sessionSeconds = Math.floor((now - activeTimers[cardId].startTime) / 1000);
                    activeTimers[cardId].elapsed += sessionSeconds;
                    card.totalTimeSpent += sessionSeconds;
                }
                if (!card.timeHistory) card.timeHistory = [];
                card.timeHistory.push({ type: 'stop', timestamp: new Date().toISOString(), duration: activeTimers[cardId].elapsed });
                delete activeTimers[cardId];
            }

            if (timerIntervals[cardId]) {
                clearInterval(timerIntervals[cardId]);
                delete timerIntervals[cardId];
            }

            saveState();
            _skipEntranceAnimation = true;
            renderBoard();
            updateGlobalTimerBar();
            showToast('Chronomètre arrêté');
        }

        function stopAllTimers(event) {
            if (event) event.stopPropagation();
            const ids = Object.keys(activeTimers).map(Number);
            ids.forEach(id => stopTimer(id));
            showToast('Tous les chronomètres arrêtés');
        }

        function getTimerElapsed(cardId) {
            const timer = activeTimers[cardId];
            if (!timer) return 0;
            let elapsed = timer.elapsed || 0;
            if (timer.startTime) {
                elapsed += Math.floor((Date.now() - timer.startTime) / 1000);
            }
            return elapsed;
        }

        function isTimerRunning(cardId) {
            return activeTimers[cardId] && activeTimers[cardId].startTime !== null;
        }

        function isTimerPaused(cardId) {
            return activeTimers[cardId] && activeTimers[cardId].startTime === null;
        }

        function formatTime(totalSeconds) {
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            if (hours > 0) {
                return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
            }
            return `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
        }

        function formatTimeCompact(totalSeconds) {
            if (totalSeconds < 60) return `${totalSeconds}s`;
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            if (hours > 0) return `${hours}h${minutes}`;
            return `${minutes}:${String(seconds).padStart(2, '0')}`;
        }

        function formatDuration(mins) {
            if (!mins) return '';
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            if (h > 0 && m > 0) return `${h}h${m}`;
            if (h > 0) return `${h}h`;
            return `${m}min`;
        }

        /**
         * Calcule un chemin SVG "part de tarte" depuis l'angle startAngle vers endAngle
         * (angles en degrés, 0° = 3h du matin, donc -90° = midi/12h).
         * On tourne dans le sens horaire.
         */
        function pieSlicePath(cx, cy, r, startDeg, endDeg) {
            const start = (startDeg - 90) * Math.PI / 180;
            const end   = (endDeg   - 90) * Math.PI / 180;
            const x1 = cx + r * Math.cos(start);
            const y1 = cy + r * Math.sin(start);
            const x2 = cx + r * Math.cos(end);
            const y2 = cy + r * Math.sin(end);
            const largeArc = (endDeg - startDeg) > 180 ? 1 : 0;
            // M 32 32 = on part du centre ; L x1 y1 = ligne au bord ; A = arc ; Z = retour centre
            return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
        }

        /**
         * Rend le CAMEMBERT visuel de temps (diagramme circulaire en parts pleines).
         * - Part colorée (mangée) = temps écoulé
         * - Part dorée (fromage intact) = temps restant
         * - Passe vert → jaune → orange → rouge
         * - En cas de dépassement, une croûte rouge clignote autour.
         */
        function renderTimerVisual(card) {
            const cardId = card.id;
            const elapsed = getTimerElapsed(cardId);
            const running = isTimerRunning(cardId);
            const paused = isTimerPaused(cardId);
            const hasEstimate = !!(card.duration && card.duration > 0);
            const estimateSec = hasEstimate ? card.duration * 60 : 0;
            const totalSpent = card.totalTimeSpent || 0;

            const CX = 32, CY = 32, R = 27, CR = 28.5; // rayon fromage, rayon croûte
            const rInnerHole = 6; // petit cercle central pour la profondeur

            let stateClass = 'state-green';
            let elapsedAngle = 0;   // en degrés
            let overtime = false;
            let elapsedFraction = 0;

            if (hasEstimate) {
                elapsedFraction = estimateSec > 0 ? elapsed / estimateSec : 0;
                if (elapsedFraction >= 1) {
                    elapsedAngle = 359.99;
                    overtime = true;
                    stateClass = 'state-red';
                } else {
                    elapsedAngle = elapsedFraction * 360;
                    if (elapsedFraction < 0.5)      stateClass = 'state-green';
                    else if (elapsedFraction < 0.75) stateClass = 'state-amber';
                    else if (elapsedFraction < 1)   stateClass = 'state-orange';
                }
            } else {
                // Mode chrono libre : cycle de 15 minutes par tour
                const cycleSec = 15 * 60;
                const phase = elapsed % cycleSec;
                elapsedFraction = phase / cycleSec;
                elapsedAngle = elapsedFraction * 360;
                if (running)       stateClass = 'state-green';
                else if (paused)   stateClass = 'state-paused';
                else if (elapsed === 0 && totalSpent === 0) stateClass = 'state-idle';
                else               stateClass = 'state-green';
            }

            if (paused && stateClass !== 'state-red') stateClass = 'state-paused';
            if (!running && !paused && elapsed === 0 && totalSpent === 0 && !hasEstimate) stateClass = 'state-idle';

            const runningClass = running ? 'running' : '';
            const overtimeClass = overtime ? 'overtime' : '';
            const patternId = `pieStripePattern-${cardId}`;

            // Construire les parts
            let cheesePath = '';  // la part "fromage" (restant)
            let elapsedPath = ''; // la part "mangée" (écoulé)
            const elapsedFill = (stateClass === 'state-paused') ? `url(#${patternId})` : null;
            const elapsedAttr = elapsedFill ? ` fill="${elapsedFill}"` : '';

            if (elapsedAngle < 0.01) {
                // Rien de mangé : tout le fromage
                cheesePath = `<circle cx="${CX}" cy="${CY}" r="${R}" class="pie-cheese"/>`;
            } else if (elapsedAngle >= 359.99) {
                // Tout mangé
                elapsedPath = `<circle cx="${CX}" cy="${CY}" r="${R}" class="pie-elapsed"${elapsedAttr}/>`;
            } else {
                // Deux parts : écoulé de 0 → elapsedAngle, reste de elapsedAngle → 360
                elapsedPath = `<path d="${pieSlicePath(CX, CY, R, 0, elapsedAngle)}" class="pie-elapsed"${elapsedAttr}/>`;
                cheesePath  = `<path d="${pieSlicePath(CX, CY, R, elapsedAngle, 360)}" class="pie-cheese"/>`;
            }

            // Point indicateur au bord de la part mangée (pointe du couteau)
            const indicatorAngle = elapsedAngle - 90; // -90 pour décaler le départ à midi
            const dotR = R - 3;
            const dotX = CX + dotR * Math.cos(indicatorAngle * Math.PI / 180);
            const dotY = CY + dotR * Math.sin(indicatorAngle * Math.PI / 180);

            return `
            <div class="timer-visual ${stateClass} ${runningClass} ${overtimeClass}">
                <svg viewBox="0 0 64 64">
                    <defs>
                        <pattern id="${patternId}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                            <rect width="6" height="6" fill="#FFE0A0"/>
                            <line x1="0" y1="0" x2="0" y2="6" stroke="#FF9500" stroke-width="2" opacity="0.6"/>
                        </pattern>
                    </defs>
                    <!-- Croûte extérieure -->
                    <circle cx="${CX}" cy="${CY}" r="${CR}" class="pie-crust"/>
                    ${cheesePath}
                    ${elapsedPath}
                    <!-- Petit cercle de profondeur au centre -->
                    <circle cx="${CX}" cy="${CY}" r="${rInnerHole}" class="pie-center"/>
                    <!-- Ligne séparatrice (seulement si 2 parts) -->
                    ${(elapsedAngle > 0.1 && elapsedAngle < 359.9) ? `<line x1="${CX}" y1="${CY}" x2="${dotX}" y2="${dotY}" class="pie-divider"/>` : ''}
                    <!-- Point indicateur mobile au bout de la part mangée -->
                    ${elapsedAngle > 0.1 ? `<circle cx="${dotX}" cy="${dotY}" r="3" class="pie-indicator-dot"/>` : ''}
                </svg>
            </div>`;
        }

        /**
         * Met à jour le camembert visuel ET le texte en temps réel (toutes les secondes).
         * Manipule directement le DOM du SVG sans re-rendre la carte.
         */
        function updateTimerDisplay(cardId) {
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const cardEl = document.querySelector(`[data-card-id="${cardId}"]`);

            if (!cardEl) { updateGlobalTimerBar(); return; }

            const bigValue = cardEl.querySelector('.timer-time-big-value');
            const elapsed = getTimerElapsed(cardId);
            if (bigValue) bigValue.textContent = formatTimeCompact(elapsed);

            const pieEl = cardEl.querySelector('.timer-visual');
            if (pieEl) {
                const svg = pieEl.querySelector('svg');
                const CX = 32, CY = 32, R = 27, CR = 28.5;

                const running = isTimerRunning(cardId);
                const paused = isTimerPaused(cardId);
                const hasEstimate = !!(card.duration && card.duration > 0);
                const estimateSec = hasEstimate ? card.duration * 60 : 0;

                let stateClass = 'state-green';
                let elapsedAngle = 0;
                let isOvertime = false;
                let elapsedFraction = 0;

                if (hasEstimate) {
                    elapsedFraction = estimateSec > 0 ? elapsed / estimateSec : 0;
                    if (elapsedFraction >= 1) {
                        elapsedAngle = 359.99;
                        isOvertime = true;
                        stateClass = 'state-red';
                    } else {
                        elapsedAngle = elapsedFraction * 360;
                        if (elapsedFraction < 0.5)      stateClass = 'state-green';
                        else if (elapsedFraction < 0.75) stateClass = 'state-amber';
                        else if (elapsedFraction < 1)   stateClass = 'state-orange';
                    }
                } else {
                    const cycleSec = 15 * 60;
                    const phase = elapsed % cycleSec;
                    elapsedFraction = phase / cycleSec;
                    elapsedAngle = elapsedFraction * 360;
                    if (running) stateClass = 'state-green';
                    else if (paused) stateClass = 'state-paused';
                    else if (elapsed === 0 && (card.totalTimeSpent||0) === 0) stateClass = 'state-idle';
                    else stateClass = 'state-green';
                }
                if (paused && stateClass !== 'state-red') stateClass = 'state-paused';

                // Appliquer les classes d'état
                pieEl.classList.remove('state-green','state-amber','state-orange','state-red','state-paused','state-idle','overtime','running');
                pieEl.classList.add(stateClass);
                if (isOvertime) pieEl.classList.add('overtime');
                if (running) pieEl.classList.add('running');

                // Recalculer les 2 parts
                let cheeseHTML = '';
                let elapsedHTML = '';
                let dividerHTML = '';
                let dotHTML = '';
                const patternId = `pieStripePattern-${cardId}`;
                const elapsedFillAttr = (stateClass === 'state-paused') ? ` fill="url(#${patternId})"` : '';

                const indicatorAngle = elapsedAngle - 90;
                const dotR = R - 3;
                const dotX = CX + dotR * Math.cos(indicatorAngle * Math.PI / 180);
                const dotY = CY + dotR * Math.sin(indicatorAngle * Math.PI / 180);

                if (elapsedAngle < 0.01) {
                    cheeseHTML = `<circle cx="${CX}" cy="${CY}" r="${R}" class="pie-cheese"/>`;
                } else if (elapsedAngle >= 359.99) {
                    elapsedHTML = `<circle cx="${CX}" cy="${CY}" r="${R}" class="pie-elapsed"${elapsedFillAttr}/>`;
                    dotHTML = `<circle cx="${CX}" cy="${CY - dotR}" r="3" class="pie-indicator-dot"/>`;
                } else {
                    elapsedHTML = `<path d="${pieSlicePath(CX, CY, R, 0, elapsedAngle)}" class="pie-elapsed"${elapsedFillAttr}/>`;
                    cheeseHTML  = `<path d="${pieSlicePath(CX, CY, R, elapsedAngle, 360)}" class="pie-cheese"/>`;
                    dividerHTML = `<line x1="${CX}" y1="${CY}" x2="${dotX}" y2="${dotY}" class="pie-divider"/>`;
                    dotHTML = `<circle cx="${dotX}" cy="${dotY}" r="3" class="pie-indicator-dot"/>`;
                }

                // Reconstruire le contenu du SVG (croûte + parts + centre + séparateur + point)
                svg.innerHTML = `
                    <defs>
                        <pattern id="${patternId}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                            <rect width="6" height="6" fill="#FFE0A0"/>
                            <line x1="0" y1="0" x2="0" y2="6" stroke="#FF9500" stroke-width="2" opacity="0.6"/>
                        </pattern>
                    </defs>
                    <circle cx="${CX}" cy="${CY}" r="${CR}" class="pie-crust"/>
                    ${cheeseHTML}
                    ${elapsedHTML}
                    <circle cx="${CX}" cy="${CY}" r="6" class="pie-center"/>
                    ${dividerHTML}
                    ${dotHTML}
                `;

                // Mettre à jour le label d'état
                const labelEl = cardEl.querySelector('.timer-elapsed-label');
                let newLabel = 'Prêt';
                let newColor = 'var(--blue)';
                if (running) {
                    if (hasEstimate) {
                        const ratio = estimateSec > 0 ? elapsed / estimateSec : 0;
                        if      (ratio < 0.5)  { newLabel = 'En cours'; newColor = '#4A7C2E'; }
                        else if (ratio < 0.75) { newLabel = 'Moitié atteinte'; newColor = '#9B7A00'; }
                        else if (ratio < 1)    { newLabel = 'Bientôt fini'; newColor = '#B85E00'; }
                        else                   { newLabel = '⏱ Dépassement !'; newColor = '#C41C14'; }
                    } else { newLabel = 'Chronométrage'; newColor = '#4A7C2E'; }
                } else if (paused) { newLabel = 'En pause'; newColor = '#B85E00'; }
                else if (elapsed > 0) { newLabel = 'Interrompu'; newColor = '#B85E00'; }
                if (labelEl) {
                    labelEl.style.color = newColor;
                    labelEl.innerHTML = `<span class="swatch" style="background:${newColor};"></span>${newLabel}`;
                }
                if (bigValue) bigValue.style.color = (running || paused || elapsed > 0) ? newColor : 'var(--ink)';

                // Ligne du bas
                const estimateLabel = cardEl.querySelector('.timer-estimate-label');
                const miniPie = estimateLabel ? estimateLabel.querySelector('.mini-pie-icon') : null;
                if (estimateLabel && hasEstimate) {
                    const remain = Math.max(0, estimateSec - elapsed);
                    const ratio = Math.min(Math.max(elapsed / estimateSec, 0), 1);
                    const percent = Math.round(ratio * 100);
                    let pieColor = '#7AB648';
                    if      (ratio < 0.5)  pieColor = '#7AB648';
                    else if (ratio < 0.75) pieColor = '#E8B800';
                    else if (ratio < 1)    pieColor = '#FF9500';
                    else                   pieColor = '#FF3B30';
                    estimateLabel.innerHTML = `<span class="mini-pie-icon" style="background:conic-gradient(${pieColor} 0 ${percent}%, #FBE8B2 ${percent}% 100%);"></span>${formatDuration(card.duration)} estimées · ${formatTimeCompact(remain)} restantes`;
                } else if (estimateLabel && !hasEstimate) {
                    const grandTotal = (card.totalTimeSpent || 0) + elapsed;
                    if (grandTotal > 0) estimateLabel.innerHTML = `Total cumulé : ${formatTimeCompact(grandTotal)}`;
                }
            }
            updateGlobalTimerBar();
        }

        /**
         * Mini camembert SVG pour la barre globale
         */
        function renderMiniTimerRing(card) {
            const cardId = card.id;
            const elapsed = getTimerElapsed(cardId);
            const running = isTimerRunning(cardId);
            const hasEstimate = !!(card.duration && card.duration > 0);
            const estimateSec = hasEstimate ? card.duration * 60 : 0;
            const C = 10, R = 7;
            let ratio = 0;
            let color = running ? '#34C759' : '#FF9500';

            if (hasEstimate) {
                ratio = Math.min(elapsed / estimateSec, 1);
                if      (ratio < 0.5)  color = '#34C759';
                else if (ratio < 0.75) color = '#FFCC00';
                else if (ratio < 1)    color = '#FF9500';
                else                   color = '#FF3B30';
            } else {
                ratio = (elapsed % 900) / 900;
            }

            // Mini camembert : fromage clair + part colorée
            let elapsedPath = '';
            let cheesePath = '';
            const CX = 10, CY = 10;
            const angle = ratio * 360;
            if (angle < 0.1) {
                cheesePath = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="#FBE8B2" stroke="#C9A96E" stroke-width="0.8"/>`;
            } else if (angle >= 359.9) {
                elapsedPath = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="${color}"/>`;
            } else {
                elapsedPath = `<path d="${pieSlicePath(CX, CY, R, 0, angle)}" fill="${color}"/>`;
                cheesePath  = `<path d="${pieSlicePath(CX, CY, R, angle, 360)}" fill="#FBE8B2"/>`;
            }
            return `<span class="mini-timer-pie" style="color:${color}">
                <svg viewBox="0 0 20 20">
                    <circle cx="${CX}" cy="${CY}" r="${R+0.8}" fill="#C9A96E"/>
                    ${cheesePath}
                    ${elapsedPath}
                </svg>
            </span>`;
        }

        function updateGlobalTimerBar() {
            const bar = document.getElementById('global-timer-bar');
            const indicators = document.getElementById('global-timer-indicators');
            const activeIds = Object.keys(activeTimers).map(Number);

            if (activeIds.length === 0) {
                bar.classList.remove('visible');
                return;
            }

            bar.classList.add('visible');
            indicators.innerHTML = activeIds.map(cardId => {
                const card = state.cards.find(c => c.id === cardId);
                if (!card) return '';
                const running = isTimerRunning(cardId);
                const elapsed = getTimerElapsed(cardId);
                const label = card.title.length > 16 ? card.title.substring(0, 16) + '…' : card.title;
                return `<span class="timer-indicator-visual ${running ? '' : 'paused-indicator'}">
                    ${renderMiniTimerRing(card)}
                    <span class="dot"></span>
                    <span class="timer-title-text">${escapeHtml(label)}</span>
                    <span class="timer-count-text">${formatTimeCompact(elapsed)}</span>
                </span>`;
            }).join('');
        }

        // =========== INITIALIZATION & STORAGE ============
        // dirHandle removed
        // dataFileHandle removed
        // archiveFileHandle removed
        // lastModifiedTime removed

        function init() {
            try {
                const overlay = document.getElementById('sync-overlay');
                if (overlay) overlay.style.display = 'none';
            } catch (error) {
                console.error('Erreur initialisation:', error);
                showToast('Erreur lors du chargement');
            }
        }

        function startApp() {
            ensureFutureColumns();
            autoRouteTasks();
            saveState();
            renderBoard();
            updateStats();
            animateStatsEntrance();
            setInterval(() => {
                updateDeadlineAlerts();
                updateStats();
                updateGlobalTimerBar();
                autoRouteTasks();
                syncWithRoot();
            }, 30000);
        }

        function normalizeColumnTitle(title) {
            return (title || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();
        }

        function isCompletedColumn(col) {
            return col && normalizeColumnTitle(col.title) === 'termine';
        }

        function isTodayColumn(col) {
            if (!col) return false;
            const t = normalizeColumnTitle(col.title);
            return t === "aujourd'hui" || t === 'a faire' || t === 'aujourdhui';
        }

        function isTomorrowColumn(col) {
            if (!col) return false;
            const t = normalizeColumnTitle(col.title);
            return t === 'demain' || t === 'en cours';
        }

        function findColumnByRole(role) {
            if (role === 'today') {
                return state.columns.find(isTodayColumn)
                    || state.columns.find(c => normalizeColumnTitle(c.title) === 'a faire')
                    || state.columns[0];
            }
            if (role === 'tomorrow') {
                return state.columns.find(isTomorrowColumn)
                    || state.columns.find(c => normalizeColumnTitle(c.title) === 'en cours');
            }
            if (role === 'completed') {
                return state.columns.find(isCompletedColumn);
            }
            if (role === 'next-week') {
                return state.columns.find(c => normalizeColumnTitle(c.title) === 'semaine prochaine');
            }
            if (role === 'next-month') {
                return state.columns.find(c => normalizeColumnTitle(c.title) === 'mois prochain');
            }
            return null;
        }

        function localDateStr(dateObj = new Date()) {
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function parseLocalDate(dateStr) {
            if (!dateStr) return null;
            const parts = String(dateStr).split('-').map(Number);
            if (parts.length < 3 || parts.some(n => isNaN(n))) return null;
            const d = new Date(parts[0], parts[1] - 1, parts[2]);
            d.setHours(0, 0, 0, 0);
            return isNaN(d.getTime()) ? null : d;
        }

        function migrateLegacyColumns() {
            state.columns.forEach(col => {
                const t = normalizeColumnTitle(col.title);
                if (t === 'a faire') {
                    col.title = "Aujourd'hui";
                    if (!col.color) col.color = '#0071E3';
                } else if (t === 'en cours') {
                    col.title = 'Demain';
                    if (!col.color || col.color === '#FF9500') col.color = '#FF9500';
                }
            });
        }

        function ensureFutureColumns() {
            migrateLegacyColumns();

            let todayCol = findColumnByRole('today');
            if (!todayCol) {
                todayCol = { id: state.nextColumnId++, title: "Aujourd'hui", color: '#0071E3' };
                state.columns.unshift(todayCol);
            } else if (normalizeColumnTitle(todayCol.title) === 'a faire') {
                todayCol.title = "Aujourd'hui";
            }

            let tomorrowCol = findColumnByRole('tomorrow');
            if (!tomorrowCol) {
                tomorrowCol = { id: state.nextColumnId++, title: 'Demain', color: '#FF9500' };
                const todayIdx = state.columns.findIndex(c => c.id === todayCol.id);
                state.columns.splice(todayIdx + 1, 0, tomorrowCol);
            } else if (normalizeColumnTitle(tomorrowCol.title) === 'en cours') {
                tomorrowCol.title = 'Demain';
            }

            let nextWeekCol = findColumnByRole('next-week');
            if (!nextWeekCol) {
                nextWeekCol = { id: state.nextColumnId++, title: 'Semaine prochaine', color: '#5856D6' };
                const termIdx = state.columns.findIndex(isCompletedColumn);
                if (termIdx !== -1) state.columns.splice(termIdx, 0, nextWeekCol);
                else state.columns.push(nextWeekCol);
            }

            let nextMonthCol = findColumnByRole('next-month');
            if (!nextMonthCol) {
                nextMonthCol = { id: state.nextColumnId++, title: 'Mois prochain', color: '#32ADE6' };
                const termIdx = state.columns.findIndex(isCompletedColumn);
                if (termIdx !== -1) state.columns.splice(termIdx, 0, nextMonthCol);
                else state.columns.push(nextMonthCol);
            }
        }

        function getTargetColumnForDate(dateStr) {
            const taskDate = parseLocalDate(dateStr);
            if (!taskDate) return null;
            taskDate.setHours(0, 0, 0, 0);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);

            const dayOfWeek = today.getDay();
            const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
            const endOfWeek = new Date(today);
            endOfWeek.setDate(today.getDate() + daysUntilSunday);
            endOfWeek.setHours(0, 0, 0, 0);

            if (taskDate.getTime() <= today.getTime()) return 'today';
            if (taskDate.getTime() === tomorrow.getTime()) return 'tomorrow';
            if (taskDate.getFullYear() > today.getFullYear()
                || (taskDate.getFullYear() === today.getFullYear() && taskDate.getMonth() > today.getMonth())) {
                return 'next-month';
            }
            if (taskDate.getTime() > endOfWeek.getTime()) return 'next-week';
            return 'later-this-week';
        }

        function autoRouteTask(card) {
            const col = state.columns.find(c => c.id === card.columnId);
            if (isCompletedColumn(col)) return false;

            const dateStr = card.startDate || card.deadline;
            const target = getTargetColumnForDate(dateStr);
            if (!target) return false;

            let targetCol = null;
            if (target === 'today') {
                targetCol = findColumnByRole('today');
            } else if (target === 'tomorrow') {
                targetCol = findColumnByRole('tomorrow');
            } else if (target === 'next-week') {
                targetCol = findColumnByRole('next-week');
            } else if (target === 'next-month') {
                targetCol = findColumnByRole('next-month');
            } else if (target === 'later-this-week') {
                // Keep in current column if it's a future column; otherwise move to today
                const t = col ? normalizeColumnTitle(col.title) : '';
                if (isTomorrowColumn(col) || t === 'semaine prochaine' || t === 'mois prochain') {
                    // Already in a future-oriented column; keep it unless today has passed
                    targetCol = col;
                } else {
                    targetCol = findColumnByRole('today');
                }
            }

            if (targetCol && targetCol.id && card.columnId !== targetCol.id) {
                card.columnId = targetCol.id;
                return true;
            }
            return false;
        }

        function autoRouteTasks() {
            let moved = false;
            state.cards.forEach(card => {
                if (autoRouteTask(card)) moved = true;
            });
            if (moved) {
                saveState();
                renderBoard();
                updateStats();
            }
        }

        function selectRootFolder() {
            const overlay = document.getElementById('sync-overlay');
            if (overlay) overlay.style.display = 'none';
            init();
        }
        function loadStateLocal() {
            try {
                const saved = safeLocalStorageGet(STORAGE_KEY);
                    const savedArchive = safeLocalStorageGet(ARCHIVE_KEY);

                    if (saved && saved.version === DATA_VERSION) {
                        state = saved;
                    } else if (saved) {
                        state = migrateData(saved);
                    }

                    if (savedArchive && Array.isArray(savedArchive)) {
                        archive = savedArchive;
                    } archive = safeJsonParse(savedArchive, []);
                if (state.columns.length === 0) createDefaultColumns();
            } catch (error) {
                console.error('Erreur chargement local:', error);
                createDefaultColumns();
            }
        }

        function migrateData(oldData) {
            const columns = (oldData.columns || []).map(col => {
                const t = (col.title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
                if (t === 'a faire') return { ...col, title: "Aujourd'hui", color: col.color || '#0071E3' };
                if (t === 'en cours') return { ...col, title: 'Demain', color: col.color || '#FF9500' };
                return col;
            });
            return {
                version: DATA_VERSION,
                columns,
                cards: (oldData.cards || []).map(card => {
                    const newCard = {
                        ...card,
                        startDate: card.startDate || null,
                        duration: card.duration || null,
                        completionNote: card.completionNote || null,
                        timeHistory: card.timeHistory || [],
                        totalTimeSpent: card.totalTimeSpent || 0
                    };
                    if (newCard.isRecurring !== undefined) {
                        newCard.recurrence = newCard.isRecurring ? { type: 'daily' } : { type: 'none' };
                        delete newCard.isRecurring;
                    }
                    if (!newCard.recurrence) newCard.recurrence = { type: 'none' };
                    return newCard;
                }),
                nextColumnId: oldData.nextColumnId || 1,
                nextCardId: oldData.nextCardId || 1
            };
        }

        // ioQueue removed

        function saveState() {
            try {
                state.version = DATA_VERSION;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
            } catch (error) {
                console.error('Save error:', error);
                if (error.name === 'QuotaExceededError') {
                    showToast('Stockage localStorage plein');
                }
            }
        }
        function saveArchive() {
            try {
                localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
            } catch (error) {
                console.error('Archive save error:', error);
            }
        }
        // =========== RENDER BOARD ============
        let _skipEntranceAnimation = false;
        let _boardMounted = false; // le stagger d'entrée ne doit jouer qu'au tout 1er rendu

        function renderBoard() {
            if (currentView === 'calendar') {
                renderCalendar();
                return;
            }
            try {
                const board = document.getElementById('board');
                if (!board) return;
                const skipAnimation = _skipEntranceAnimation;
                _skipEntranceAnimation = false;
                // Le stagger d'entrée est un délice "première fois" : on ne le
                // rejoue pas à chaque create/edit/drag, seulement au 1er rendu.
                const playEntrance = !skipAnimation && !_boardMounted;
                board.innerHTML = '';
                state.columns.forEach((column, colIndex) => {
                    const colEl = createColumnElement(column);
                    if (playEntrance) {
                        colEl.classList.add('column-enter');
                        colEl.style.setProperty('--col-stagger-delay', `${colIndex * 60}ms`);
                    }
                    board.appendChild(colEl);
                });
                // Add staggered card entrance (skip during timer updates)
                if (playEntrance) {
                    document.querySelectorAll('.column').forEach(colEl => {
                        const cards = colEl.querySelectorAll('.card');
                        cards.forEach((cardEl, i) => {
                            cardEl.classList.add('card-enter');
                            cardEl.style.setProperty('--stagger-delay', `${i * 40}ms`);
                        });
                    });
                }
                _boardMounted = true;
                initSortable();
                updateDeadlineAlerts();
                if (activeStatFilter) {
                    applyStatFilter();
                    updateStatFilterUI();
                }
            } catch (error) {
                console.error('Erreur rendu:', error);
            }
        }

        function createColumnElement(column) {
            const columnEl = document.createElement('div');
            columnEl.className = 'column';
            columnEl.dataset.columnId = column.id;

            let cards = state.cards.filter(c => c.columnId === column.id);
            
            cards.sort((a, b) => {
                if (a.startDate && b.startDate) {
                    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
                    const timeA = a.scheduledTime || '23:59';
                    const timeB = b.scheduledTime || '23:59';
                    return timeA.localeCompare(timeB);
                }
                if (a.startDate) return -1;
                if (b.startDate) return 1;
                return 0;
            });

            columnEl.innerHTML = `
                <div class="column-header">
                    <div class="column-title-wrap">
                        <span class="column-color-bar" style="background:${column.color || '#6E6E73'}" onclick="event.stopPropagation();changeColumnColor(${column.id})" title="Changer la couleur"></span>
                        <div class="column-title" onclick="startEditColumnTitle(${column.id})">${escapeHtml(column.title)}</div>
                    </div>
                    <div class="column-actions">
                        <button class="column-btn column-btn-filter" onclick="event.stopPropagation();toggleColumnFilter(${column.id})" title="Filtrer" id="filter-btn-${column.id}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                        </button>
                        <button class="column-btn" onclick="startEditColumnTitle(${column.id})" title="Renommer">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="column-btn" onclick="deleteColumn(${column.id})" title="Supprimer">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        </button>
                    </div>
                </div>
                <div class="column-filter-bar filter-bar-closed" id="filter-bar-${column.id}" style="display:none;">
                    <div class="filter-search-wrap">
                        <svg class="filter-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" class="filter-search-input" id="filter-search-${column.id}" placeholder="Rechercher..." oninput="applyColumnFilter(${column.id})">
                    </div>
                    <div class="filter-date-row">
                        <input type="date" class="filter-date-input" id="filter-date-start-${column.id}" onchange="applyColumnFilter(${column.id})" title="Du">
                        <input type="date" class="filter-date-input" id="filter-date-end-${column.id}" onchange="applyColumnFilter(${column.id})" title="Au">
                    </div>
                    <div class="filter-options-row">
                        <select class="filter-select" id="filter-priority-${column.id}" onchange="applyColumnFilter(${column.id})">
                            <option value="">Toute priorité</option>
                            <option value="high">Haute</option>
                            <option value="medium">Moyenne</option>
                            <option value="low">Basse</option>
                        </select>
                        <select class="filter-select" id="filter-status-${column.id}" onchange="applyColumnFilter(${column.id})">
                            <option value="">Tout statut</option>
                            <option value="overdue">En retard</option>
                            <option value="soon">Bientôt</option>
                            <option value="none">Normal</option>
                        </select>
                        <button class="filter-clear-btn" onclick="clearColumnFilter(${column.id})" title="Effacer les filtres">✕</button>
                    </div>
                </div>
                <div class="column-cards" data-column-id="${column.id}">
                    ${cards.length === 0 ? '<div class="empty-column">Aucune tâche</div>' : ''}
                    ${cards.map(card => createCardHTML(card)).join('')}
                </div>
                <div class="column-footer">
                    <button class="add-card-btn" onclick="showAddCardModal(${column.id})">+ Ajouter une tâche</button>
                </div>
            `;
            return columnEl;
        }

        function createCardHTML(card) {
            const priorityClass = `badge-priority-${card.priority}`;
            let badges = `<span class="badge ${priorityClass}">${priorityLabels[card.priority]}</span>`;
            if (card.category) {
                badges += `<span class="badge badge-category" style="background: ${card.categoryColor || 'var(--bg-alt)'}; color: white;">${escapeHtml(card.category)}</span>`;
            }
            if (card.recurrence && card.recurrence.type !== 'none') {
                let recLabel = getRecurrenceBadgeLabel(card);
                badges += `<span class="badge badge-recurring" title="${escapeHtml(getRecurrenceSummary(card))}">${recLabel}</span>`;
            }

            let info = '';
            if (card.startDate) {
                info += `<div class="card-info-item">${icons.calendar}<span>${escapeHtml(card.startDate)}</span></div>`;
            }
            if (card.duration) {
                const hours = Math.floor(card.duration / 60);
                const minutes = card.duration % 60;
                let durationText = '';
                if (hours > 0) durationText += `${hours}h`;
                if (minutes > 0) durationText += `${minutes}min`;
                info += `<div class="card-info-item">${icons.clock}<span>${durationText}</span></div>`;
            }
            if (card.scheduledTime) {
                info += `<div class="card-info-item">${icons.timer}<span>${escapeHtml(card.scheduledTime)}</span></div>`;
            }
            if (card.deadline) {
                const deadlineStatus = getDeadlineStatus(card.deadline, card.scheduledTime);
                let alertIcon = '';
                if (deadlineStatus === 'overdue') alertIcon = icons.alert;
                else if (deadlineStatus === 'soon') alertIcon = icons.timer;
                info += `<div class="card-info-item">${alertIcon}<span>${escapeHtml(card.deadline)}</span></div>`;
            }

            let checklistHTML = '';
            if (card.checklist && card.checklist.length > 0) {
                const completed = card.checklist.filter(i => i.checked).length;
                const total = card.checklist.length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                const allDone = completed === total;
                checklistHTML = `<div class="card-checklist ${allDone ? 'all-done' : ''}" onclick="event.stopPropagation(); showTaskSummary(${card.id})">
                    ${allDone ? '<span class="card-checklist-check">✓</span>' : icons.checklist}
                    <span class="card-checklist-label">${completed}/${total} sous-tâches</span>
                    <span class="card-checklist-progress"><span class="card-checklist-progress-fill" style="width:${pct}%"></span></span>
                </div>`;
            }

            let completionNoteHTML = '';
            if (card.completionNote) {
                completionNoteHTML = `<div class="card-completion-note" onclick="event.stopPropagation(); showTaskSummary(${card.id})">Note : ${escapeHtml(card.completionNote)}</div>`;
            }

            if (card.totalTimeSpent && card.totalTimeSpent > 0 && !activeTimers[card.id]) {
                info += `<div class="card-info-item">${icons.timer}<span>Temps total : ${formatTime(card.totalTimeSpent)}</span></div>`;
            }

            const deadlineClass = getDeadlineCSSClass(card.deadline, card.scheduledTime);
            const timerRunning = isTimerRunning(card.id);
            const timerPaused = isTimerPaused(card.id);
            const hasTimer = activeTimers[card.id] !== undefined;

            let timerClass = '';
            if (timerRunning) timerClass = 'timer-running';
            else if (timerPaused) timerClass = 'timer-paused';

            const isCompletedColumnCard = (() => {
                const col = state.columns.find(c => c.id === card.columnId);
                return isCompletedColumn(col);
            })();

            let timerControlsHTML = '';
            if (isCompletedColumnCard) {
                // Tâche terminée : affichage simple (pas de boutons, camembert + temps + label)
                if (card.totalTimeSpent && card.totalTimeSpent > 0) {
                    const completedCard = { ...card, duration: card.duration || Math.max(1, Math.ceil(card.totalTimeSpent / 60)) };
                    timerControlsHTML = `
                        <div class="timer-controls-visual completed-visual" style="margin-top:var(--space-3);">
                            <div class="timer-row-main">
                                ${renderTimerVisual(completedCard)}
                                <div class="timer-time-block">
                                    <div class="timer-time-big timer-time-big-value" style="color:var(--ink);">${formatTimeCompact(card.totalTimeSpent)}</div>
                                    <div class="timer-elapsed-label" style="color:var(--sys-green);"><span class="swatch" style="background:var(--sys-green);"></span>Tâche terminée</div>
                                    <div class="timer-estimate-label" style="color:var(--ink-soft);font-weight:500;text-transform:none;letter-spacing:0;font-size:11px;">temps total enregistré</div>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    timerControlsHTML = `
                        <div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--bg-alt);border-radius:var(--radius);text-align:center;font-size:13px;color:var(--ink-soft);border:1px solid var(--line);">Tâche terminée</div>
                    `;
                }
            } else {
                // Carte active : interface visuelle avec anneau circulaire
                const elapsed = getTimerElapsed(card.id);
                const hasEstimate = !!(card.duration && card.duration > 0);
                const estimateSec = hasEstimate ? card.duration * 60 : 0;

                let stateColor = 'var(--sys-green)';
                let stateLabel = 'Prêt';
                if (timerRunning) {
                    if (hasEstimate) {
                        const ratio = estimateSec > 0 ? elapsed / estimateSec : 0;
                        if (ratio < 0.5) { stateColor = 'var(--sys-green)'; stateLabel = 'En cours'; }
                        else if (ratio < 0.75) { stateColor = 'var(--sys-yellow)'; stateLabel = 'Moitié atteinte'; }
                        else if (ratio < 1) { stateColor = 'var(--sys-orange)'; stateLabel = 'Bientôt fini'; }
                        else { stateColor = 'var(--sys-red)'; stateLabel = '⏱ Dépassement !'; }
                    } else {
                        stateColor = 'var(--sys-green)';
                        stateLabel = 'Chronométrage';
                    }
                } else if (timerPaused) {
                    stateColor = 'var(--sys-orange)';
                    stateLabel = 'En pause';
                } else if (hasTimer && elapsed > 0) {
                    stateColor = 'var(--sys-orange)';
                    stateLabel = 'Interrompu';
                } else {
                    stateColor = 'var(--blue)';
                    stateLabel = 'Prêt';
                }

                let bigTimeColor = stateColor;
                if (!timerRunning && !timerPaused && elapsed === 0) bigTimeColor = 'var(--ink)';

                let remainContent = '';
                if (hasEstimate) {
                    const remain = Math.max(0, estimateSec - elapsed);
                    remainContent = `<span class="mini-pie-icon"></span>${formatDuration(card.duration)} estimées · ${formatTimeCompact(remain)} restantes`;
                } else {
                    const grandTotal = (card.totalTimeSpent || 0) + elapsed;
                    if (grandTotal > 0) {
                        remainContent = `Total cumulé : ${formatTimeCompact(grandTotal)}`;
                    } else {
                        remainContent = `Appuyez sur lecture pour démarrer`;
                    }
                }

                const mainBtnIcon = timerRunning
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>`
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="margin-left:2px;"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
                const mainBtnAction = timerRunning ? `pauseTimer(${card.id}, event)` : `startTimer(${card.id}, event)`;
                const mainBtnClass = timerRunning ? 'timer-btn-v-pause' : 'timer-btn-v-play';
                const mainBtnTitle = timerRunning ? 'Mettre en pause' : (hasTimer ? 'Reprendre' : 'Démarrer le chronomètre');

                const stopBtn = hasTimer
                    ? `<button class="timer-btn-v timer-btn-v-stop" onclick="stopTimer(${card.id}, event)" title="Arrêter et enregistrer" aria-label="Arrêter">
                         <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>
                       </button>`
                    : '';

                // Calcul de la couleur du mini-pie-icon
                const miniPieColor = stateColor.startsWith('var') ? '#34C759' : stateColor;
                const miniPieRatio = hasEstimate ? Math.min(Math.max(elapsed / estimateSec, 0), 1) : 0;
                const miniPiePercent = Math.round(miniPieRatio * 100);

                timerControlsHTML = `
                    <div class="timer-controls-visual" data-timer-card="${card.id}">
                        <div class="timer-row-main">
                            ${renderTimerVisual(card)}
                            <div class="timer-time-block">
                                <div class="timer-time-big timer-time-big-value" style="color:${bigTimeColor};" data-card="${card.id}">${formatTimeCompact(elapsed)}</div>
                                <div class="timer-elapsed-label" style="color:${stateColor};"><span class="swatch" style="background:${stateColor};"></span>${stateLabel}</div>
                            </div>
                            <button class="timer-btn-v ${mainBtnClass}" onclick="${mainBtnAction}" title="${mainBtnTitle}" aria-label="${timerRunning ? 'Pause' : 'Lecture'}">
                                ${mainBtnIcon}
                            </button>
                        </div>
                        <div class="timer-row-sub">
                            <div class="timer-sub-meta">
                                <div class="timer-estimate-label" style="color:var(--ink-soft);">
                                    <span class="mini-pie-icon" style="background:conic-gradient(${miniPieColor} 0 ${miniPiePercent}%, #FBE8B2 ${miniPiePercent}% 100%);"></span>${remainContent}
                                </div>
                            </div>
                            ${stopBtn}
                        </div>
                    </div>
                    <button class="btn btn-success" onclick="showCompleteTaskModal(${card.id}, event)" style="width: 100%; margin-top: var(--space-2); justify-content: center; font-size: 13px; padding: 10px 16px; border-radius: var(--radius-pill);">
                        ✓ Terminer
                    </button>
                `;
            }

            return `
                <div class="card ${deadlineClass} ${timerClass}" data-card-id="${card.id}" onclick="showTaskSummary(${card.id})">
                    ${getDeadlineAlert(card.deadline, card.scheduledTime)}
                    <div class="card-header">
                        <div class="card-title">${escapeHtml(card.title)}</div>
                        <button class="card-menu-btn" onclick="event.stopPropagation(); showCardMenu(event, ${card.id})">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                        </button>
                    </div>
                    ${card.description ? `<div style="font-size: 13px; color: var(--ink-soft); margin-bottom: var(--space-2); line-height: 1.4;">${escapeHtml(card.description.length > 30 ? card.description.substring(0, 30) + '...' : card.description)}</div>` : ''}
                    <div class="card-badges">${badges}</div>
                    <div class="card-info">${info}</div>
                    ${checklistHTML}
                    ${completionNoteHTML}
                    ${timerControlsHTML}
                </div>
            `;
        }

        // =========== DEADLINE ALERTS ============
        function getDeadlineStatus(deadline, scheduledTime) {
            if (!deadline) return 'none';
            const now = new Date();
            const deadlineDate = new Date(deadline);
            if (scheduledTime) {
                const [hours, minutes] = scheduledTime.split(':');
                deadlineDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
            } else {
                deadlineDate.setHours(23, 59, 59, 999);
            }
            if (deadlineDate < now) return 'overdue';
            const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
            if (deadlineDate <= twoHoursFromNow) return 'soon';
            return 'none';
        }

        function getDeadlineCSSClass(deadline, scheduledTime) {
            const status = getDeadlineStatus(deadline, scheduledTime);
            if (status === 'overdue') return 'deadline-overdue';
            if (status === 'soon') return 'deadline-soon';
            return '';
        }

        function getDeadlineAlert(deadline, scheduledTime) {
            const status = getDeadlineStatus(deadline, scheduledTime);
            if (status === 'overdue') return '<span class="deadline-alert">🚨</span>';
            if (status === 'soon') return '<span class="deadline-alert">⏰</span>';
            return '';
        }

        function updateDeadlineAlerts() {
            document.querySelectorAll('.card').forEach(cardEl => {
                const cardId = parseInt(cardEl.dataset.cardId);
                const card = state.cards.find(c => c.id === cardId);
                if (card) {
                    const timerRunning = isTimerRunning(cardId);
                    const timerPaused = isTimerPaused(cardId);
                    let timerClass = '';
                    if (timerRunning) timerClass = 'timer-running';
                    else if (timerPaused) timerClass = 'timer-paused';
                    cardEl.className = `card ${getDeadlineCSSClass(card.deadline, card.scheduledTime)} ${timerClass}`;
                    const existingAlert = cardEl.querySelector('.deadline-alert');
                    if (existingAlert) existingAlert.remove();
                    const alertHTML = getDeadlineAlert(card.deadline, card.scheduledTime);
                    if (alertHTML) cardEl.insertAdjacentHTML('afterbegin', alertHTML);
                }
            });
        }

        // =========== DRAG & DROP ============
        function initSortable() {
            try {
                function cleanupDragClasses() {
                    document.querySelectorAll('.card').forEach(el => {
                        el.classList.remove('drag-leave', 'drag-over', 'drag-chosen');
                    });
                    document.querySelectorAll('.column').forEach(el => {
                        el.classList.remove('drag-column-over');
                    });
                    document.querySelectorAll('.column-cards').forEach(el => {
                        el.classList.remove('sortable-highlight');
                    });
                }

                document.querySelectorAll('.column-cards').forEach(container => {
                    createSortable(container, {
                        group: 'cards',
                        animation: 250,
                        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
                        ghostClass: 'dragging',
                        dragClass: 'drag-over',
                        filter: '.timer-controls, .timer-btn, .timer-display, .timer-controls-visual, .timer-btn-v, .timer-visual',
                        preventOnFilter: false,
                        delay: 80,
                        delayOnTouchOnly: true,
                        touchStartThreshold: 5,
                        onStart: function(evt) {
                            cleanupDragClasses();
                            evt.item.classList.remove('drag-enter');
                            evt.item.classList.add('drag-leave');
                            evt.from.classList.add('sortable-highlight');
                        },
                        onEnd: function(evt) {
                            try {
                                cleanupDragClasses();
                                const cardId = parseInt(evt.item.dataset.cardId);
                                const newColumnId = parseInt(evt.to.dataset.columnId);
                                const card = state.cards.find(c => c.id === cardId);
                                
                                if (card) {
                                    const newCol = state.columns.find(c => c.id === newColumnId);
                                    
                                    if (isCompletedColumn(newCol) && card.columnId !== newColumnId) {
                                        showTaskSummary(cardId);
                                        renderBoard();
                                        showToast("Veuillez remplir la note pour terminer la tâche.");
                                        return;
                                    }

                                    card.columnId = newColumnId;
                                    saveState();
                                    updateStats();
                                    renderBoard();
                                }
                            } catch (error) {
                                cleanupDragClasses();
                                console.error('Erreur drag & drop:', error);
                            }
                        }
                    });
                });

                createSortable(document.getElementById('board'), {
                    animation: 250,
                    easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
                    handle: '.column-header',
                    ghostClass: 'dragging',
                    delay: 100,
                    delayOnTouchOnly: true,
                    touchStartThreshold: 5,
                    onStart: function(evt) {
                        cleanupDragClasses();
                        evt.item.classList.add('drag-leave');
                    },
                    onEnd: function(evt) {
                        try {
                            cleanupDragClasses();
                            evt.item.classList.add('drag-enter');
                            
                            const columnOrder = [];
                            document.querySelectorAll('.column').forEach(col => {
                                columnOrder.push(parseInt(col.dataset.columnId));
                            });
                            const newColumns = [];
                            columnOrder.forEach(id => {
                                const col = state.columns.find(c => c.id === id);
                                if (col) newColumns.push(col);
                            });
                            state.columns = newColumns;
                            saveState();
                        } catch (error) {
                            cleanupDragClasses();
                            console.error('Erreur tri colonnes:', error);
                        }
                    }
                });
            } catch (error) {
                console.error('Erreur Sortable:', error);
            }
        }

        // =========== CARD ACTIONS MENU (menu "..." des cartes) ============
        // Ces deux fonctions étaient appelées mais jamais définies : le bouton
        // "3 points" / hamburger ne réagissait plus au clic. On les restaure.
        function showCardMenu(event, cardId) {
            if (event) event.stopPropagation();
            closeCardMenu();

            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const col = state.columns.find(c => c.id === card.columnId);
            const isCompleted = isCompletedColumn(col);

            const actions = [];
            actions.push({ label: '✏️\u00A0\u00A0Modifier', onclick: `closeCardMenu(); editCard(${cardId})` });
            actions.push({ label: '⧉\u00A0\u00A0Dupliquer', onclick: `closeCardMenu(); duplicateCard(${cardId})` });
            if (!isCompleted) {
                actions.push({ label: '✓\u00A0\u00A0Terminer', cls: 'success', onclick: `closeCardMenu(); showCompleteTaskModal(${cardId}, event)` });
            }
            actions.push({ label: '🗑\u00A0\u00A0Supprimer', cls: 'danger', onclick: `closeCardMenu(); deleteCard(${cardId})` });

            const menu = document.createElement('div');
            menu.className = 'card-actions-menu';
            menu.id = 'card-menu'; // référencé par le gestionnaire de clic global
            menu.innerHTML = actions.map(a =>
                `<button class="${a.cls || ''}" onclick="event.stopPropagation(); ${a.onclick}">${a.label}</button>`
            ).join('');
            document.body.appendChild(menu);

            // Positionnement intelligent : on garde le menu à l'écran
            const rect = menu.getBoundingClientRect();
            let x = event.clientX || 0;
            let y = event.clientY || 0;
            const margin = 8;
            if (x + rect.width > window.innerWidth - margin) x = window.innerWidth - rect.width - margin;
            if (y + rect.height > window.innerHeight - margin) y = window.innerHeight - rect.height - margin;
            menu.style.left = Math.max(margin, x) + 'px';
            menu.style.top = Math.max(margin, y) + 'px';
        }

        function closeCardMenu() {
            const menu = document.getElementById('card-menu');
            if (menu && menu.parentNode) menu.remove();
        }

        // =========== COLUMN MANAGEMENT ============
        function showAddColumnModal() {
            const modal = createModal('Nouvelle colonne', `
                <div class="form-group">
                    <label class="form-label">Titre</label>
                    <input type="text" class="form-input" id="new-column-title" placeholder="Ex: En attente" autofocus>
                </div>
            `, [
                { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                { text: 'Ajouter', class: 'btn-primary', onclick: 'addColumn()' }
            ]);
            document.body.appendChild(modal);
        }

        function addColumn() {
            const title = document.getElementById('new-column-title').value.trim();
            if (!title) {
                showToast('Veuillez saisir un titre');
                return;
            }
            const availColor = COLUMN_COLORS.find(c => !state.columns.map(col => col.color).filter(Boolean).includes(c)) || '#6E6E73';
            state.columns.push({ id: state.nextColumnId++, title: title, color: availColor });
            saveState();
            closeModal();
            renderBoard();
            showToast('Colonne ajoutée');
        }

        function startEditColumnTitle(columnId) {
            const column = state.columns.find(c => c.id === columnId);
            if (!column) return;
            const columnEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
            const titleEl = columnEl.querySelector('.column-title');
            titleEl.outerHTML = `<input type="text" class="column-title-input" value="${escapeHtml(column.title)}" id="edit-column-title-${columnId}">`;
            const input = document.getElementById(`edit-column-title-${columnId}`);
            input.focus();
            input.select();
            input.addEventListener('blur', () => saveColumnTitle(columnId));
            input.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveColumnTitle(columnId); });
        }

        function saveColumnTitle(columnId) {
            const input = document.getElementById(`edit-column-title-${columnId}`);
            if (!input) return;
            const newTitle = input.value.trim();
            const column = state.columns.find(c => c.id === columnId);
            if (newTitle && column) {
                column.title = newTitle;
                saveState();
            }
            renderBoard();
        }

        function deleteColumn(columnId) {
            if (state.columns.length <= 1) {
                showToast('Action impossible : Vous devez garder au moins une colonne.');
                return;
            }
            if (!confirm('Supprimer cette colonne ? Les cartes seront déplacées vers la première colonne.')) return;
            const cardsInColumn = state.cards.filter(c => c.columnId === columnId);
            const firstColumnId = state.columns[0]?.id;
            cardsInColumn.forEach(card => { card.columnId = firstColumnId || 1; });
            state.columns = state.columns.filter(c => c.id !== columnId);
            saveState();
            renderBoard();
            showToast('Colonne supprimée');
        }

        // =========== TASK SUMMARY ============
        function showTaskSummary(cardId) {
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const col = state.columns.find(c => c.id === card.columnId);
            const isCompleted = isCompletedColumn(col);

            let body = `
                <div class="task-summary">
                    <div class="task-summary-header">
                        <div class="task-summary-title">${escapeHtml(card.title)}</div>
                        <div class="task-summary-badges">
                            <span class="badge badge-priority-${card.priority}">${priorityLabels[card.priority]}</span>
                            ${card.category ? `<span class="badge badge-category" style="background: ${card.categoryColor || 'var(--bg-alt)'}; color: white;">${escapeHtml(card.category)}</span>` : ''}
                        </div>
                    </div>
                    <div class="task-summary-info">
                        ${card.startDate ? `<div class="info-item"><div class="info-label">Date de début</div><div class="info-value">${icons.calendar} ${escapeHtml(card.startDate)}</div></div>` : ''}
                        ${card.duration ? `<div class="info-item"><div class="info-label">Durée estimée</div><div class="info-value">${icons.clock} ${Math.floor(card.duration / 60)}h ${card.duration % 60}min</div></div>` : ''}
                        ${card.scheduledTime ? `<div class="info-item"><div class="info-label">Horaire prévu</div><div class="info-value">${icons.timer} ${escapeHtml(card.scheduledTime)}</div></div>` : ''}
                        ${card.deadline ? `<div class="info-item"><div class="info-label">Date limite</div><div class="info-value">${icons.calendar} ${escapeHtml(card.deadline)}</div></div>` : ''}
                        ${card.totalTimeSpent > 0 ? `<div class="info-item"><div class="info-label">Temps total</div><div class="info-value">${icons.timer} ${formatTime(card.totalTimeSpent)}</div></div>` : ''}
                    </div>
            `;

            if (card.description) {
                body += `
                    <div class="task-summary-section">
                        <h3>Description</h3>
                        <div style="padding: var(--space-4); background: var(--bg-alt); border-radius: var(--radius); font-size: 15px; line-height: 1.6; color: var(--ink); border: 1px solid var(--line);">
                            ${escapeHtml(card.description).replace(/\n/g, '<br>')}
                        </div>
                    </div>
                `;
            }

            if (card.checklist && card.checklist.length > 0) {
                const completed = card.checklist.filter(i => i.checked).length;
                const total = card.checklist.length;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                const allDone = completed === total;
                body += `
                    <div class="task-summary-section checklist-section">
                        <div class="checklist-section-head">
                            <h3>Sous-tâches · ${completed}/${total}</h3>
                            <div class="checklist-progress"><div class="checklist-progress-fill ${allDone ? 'is-complete' : ''}" style="--progress:${pct}%"></div></div>
                        </div>
                        <div>
                            ${card.checklist.map((item, index) => `
                                <div class="checklist-item-detailed ${item.checked ? 'is-checked' : ''}">
                                    <div class="checklist-check" role="checkbox" aria-checked="${item.checked}" tabindex="0"
                                         onclick="toggleChecklistItem(${cardId}, ${index})"
                                         onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();toggleChecklistItem(${cardId}, ${index})}"></div>
                                    <div class="checklist-text ${item.checked ? 'completed' : ''}">${escapeHtml(item.text)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            if (card.timeHistory && card.timeHistory.length > 0) {
                body += `
                    <div class="time-tracking">
                        <h4>Suivi du temps</h4>
                        <div class="time-entries">
                            ${card.timeHistory.slice(-10).reverse().map(entry => `
                                <div class="time-entry">
                                    ${entry.type === 'play' ? '▶ Démarré' : entry.type === 'pause' ? '⏸ En pause' : '⏹ Arrêté'}
                                    à ${new Date(entry.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                    ${entry.duration ? ` · ${formatTime(entry.duration)}` : ''}
                                </div>
                            `).join('')}
                        </div>
                        ${card.totalTimeSpent ? `<div style="margin-top: var(--space-3); font-weight: 700; color: var(--blue); font-size: 15px;">Total : ${formatTime(card.totalTimeSpent)}</div>` : ''}
                    </div>
                `;
            }

            if (card.completionNote) {
                body += `
                    <div class="task-summary-section">
                        <h3>Note de complétion</h3>
                        <div style="padding: var(--space-4); background: var(--sys-green-bg); border-radius: var(--radius); font-size: 14px; line-height: 1.6; color: #248A3D; font-style: italic; border: 1px solid rgba(52,199,89,0.15);">
                            ${escapeHtml(card.completionNote).replace(/\n/g, '<br>')}
                        </div>
                    </div>
                `;
            }

            if (!isCompleted) {
                body += `
                    <div class="completion-section">
                        <h3>Marquer comme terminée</h3>
                        <textarea class="completion-note" id="completion-note" placeholder="Ajoutez une note ou un résumé avant de terminer la tâche…"></textarea>
                        <div class="completion-actions">
                            <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
                            <button class="btn btn-success" onclick="completeTask(${cardId})">Terminer la tâche</button>
                        </div>
                    </div>
                `;
            }

            const modal = createModal('Détail de la tâche', body, []);
            document.body.appendChild(modal);
        }

        function toggleChecklistItem(cardId, itemIndex) {
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            card.checklist[itemIndex].checked = !card.checklist[itemIndex].checked;
            saveState();
            closeModal();
            showTaskSummary(cardId);
            renderBoard();
            updateStats();
        }

        function showCompleteTaskModal(cardId, event) {
            if (event) event.stopPropagation();
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            
            const modal = createModal('Terminer la tâche', `
                <div style="font-size: 15px; margin-bottom: var(--space-4); color: var(--ink-soft); line-height: 1.4;">
                    Tâche : <strong style="color: var(--ink);">${escapeHtml(card.title)}</strong>
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label class="form-label">Note de complétion (obligatoire)</label>
                    <textarea class="completion-note" id="direct-completion-note" placeholder="Ajoutez une note ou un résumé avant de terminer la tâche…" style="width: 100%; min-height: 120px; padding: var(--space-4); background: var(--bg-alt); border-radius: var(--radius); border: 1px solid var(--line); color: var(--ink);" autofocus></textarea>
                </div>
            `, [
                { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                { text: 'Terminer la tâche', class: 'btn-success', onclick: `submitDirectCompletion(${cardId})` }
            ]);
            document.body.appendChild(modal);
            setTimeout(() => {
                const txt = document.getElementById('direct-completion-note');
                if (txt) txt.focus();
            }, 50);
        }

        function submitDirectCompletion(cardId) {
            const noteEl = document.getElementById('direct-completion-note');
            const note = noteEl ? noteEl.value.trim() : '';
            if (!note) {
                showToast('La note de complétion est obligatoire');
                return;
            }
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            if (activeTimers[cardId]) stopTimer(cardId);
            const completedColumn = findColumnByRole('completed');
            if (!completedColumn) {
                showToast('Colonne "Terminé" introuvable');
                return;
            }
            card.columnId = completedColumn.id;
            card.completionNote = note;
            card.completedAt = new Date().toISOString();
            
            handleRecurrenceOnCompletion(card);
            handleDependenciesOnCompletion(card);
            
            saveState();
            closeAllModals();
            renderBoard();
            updateStats();
            showToast('Tâche terminée');
        }

        function completeTask(cardId) {
            const note = document.getElementById('completion-note').value.trim();
            if (!note) {
                showToast('La note de complétion est obligatoire');
                return;
            }
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            if (activeTimers[cardId]) stopTimer(cardId);
            const completedColumn = findColumnByRole('completed');
            if (!completedColumn) {
                showToast('Colonne "Terminé" introuvable');
                return;
            }
            card.columnId = completedColumn.id;
            card.completionNote = note;
            card.completedAt = new Date().toISOString();
            
            handleRecurrenceOnCompletion(card);
            handleDependenciesOnCompletion(card);
            
            saveState();
            closeModal();
            renderBoard();
            updateStats();
            showToast('Tâche terminée');
        }

        function buildRecurrenceFromUI() {
            // Sync state from DOM before building
            updateRecSummary();
            const freq = recState.freq;
            if (freq === 'none') return { type: 'none' };
            const rec = {
                type: freq,
                interval: recState.interval,
                endType: recState.endType
            };
            if (recState.endType === 'after') rec.endAfter = recState.endAfter;
            if (recState.endType === 'onDate') rec.endDate = recState.endDate;
            if (freq === 'weekly') rec.daysOfWeek = [...recState.daysOfWeek];
            if (freq === 'monthly') {
                rec.dayOfMonth = recState.isLastDay ? -1 : recState.dayOfMonth;
                rec.isLastDay = recState.isLastDay;
            }
            return rec;
        }

        function getRecurrenceSummary(card) {
            const rec = card.recurrence || { type: 'none' };
            if (!rec || rec.type === 'none') return '';
            const days = ['Lu','Ma','Me','Je','Ve','Sa','Di'];
            let text = '↻ ';
            const interval = rec.interval || 1;
            if (rec.type === 'daily') {
                text += interval > 1 ? `Tous les ${interval} jours` : 'Tous les jours';
            } else if (rec.type === 'weekly') {
                text += interval > 1 ? `Toutes les ${interval} sem.` : 'Chaque semaine';
                if (rec.daysOfWeek && rec.daysOfWeek.length > 0 && rec.daysOfWeek.length < 7) {
                    text += ' ' + rec.daysOfWeek.map(d => days[d-1]).join(',');
                }
            } else if (rec.type === 'monthly') {
                text += interval > 1 ? `Tous les ${interval} mois` : 'Chaque mois';
                if (rec.isLastDay) text += ' (dernier j.)';
                else if (rec.dayOfMonth) text += ` le ${rec.dayOfMonth}`;
            }
            return text;
        }

        function getRecurrenceBadgeLabel(card) {
            const rec = card.recurrence || { type: 'none' };
            if (!rec || rec.type === 'none') return '';
            if (rec.type === 'dependent') {
                const depTask = state.cards.find(c => c.id === rec.dependencyId);
                return '↻ ' + (depTask ? `Après: ${depTask.title.substring(0,12)}` : 'Dépendante');
            }
            const days = ['Lu','Ma','Me','Je','Ve','Sa','Di'];
            let label = '↻ ';
            const intv = rec.interval || 1;
            if (rec.type === 'daily') label += intv > 1 ? `${intv}j` : 'Jour';
            else if (rec.type === 'weekly') {
                label += intv > 1 ? `${intv} sem.` : 'Sem.';
                if (rec.daysOfWeek && rec.daysOfWeek.length > 0 && rec.daysOfWeek.length < 7) {
                    label += ' ' + rec.daysOfWeek.map(d => days[d-1]).join(',');
                }
            } else if (rec.type === 'monthly') {
                label += intv > 1 ? `${intv} mois` : 'Mois';
                if (rec.isLastDay) label += ' fin';
                else if (rec.dayOfMonth) label += ` ${rec.dayOfMonth}`;
            }
            return label;
        }

        function getNextRecurrenceDate(card) {
            const rec = card.recurrence;
            if (!rec || rec.type === 'none' || rec.type === 'dependent') return null;

            let baseDate = card.startDate ? new Date(card.startDate + 'T00:00:00') : new Date();
            let nextDate = new Date(baseDate);

            if (rec.type === 'daily') {
                nextDate.setDate(nextDate.getDate() + (rec.interval || 1));
            } else if (rec.type === 'weekly') {
                const dow = rec.daysOfWeek && rec.daysOfWeek.length > 0 ? rec.daysOfWeek : [(baseDate.getDay() || 7)];
                // Find next matching day
                for (let i = 1; i <= 7; i++) {
                    nextDate.setDate(baseDate.getDate() + i);
                    let nd = nextDate.getDay(); if (nd === 0) nd = 7;
                    if (dow.includes(nd)) break;
                }
                // Advance by (interval-1) more weeks if interval > 1
                if ((rec.interval || 1) > 1) {
                    nextDate.setDate(nextDate.getDate() + ((rec.interval || 1) - 1) * 7);
                }
            } else if (rec.type === 'monthly') {
                const targetDay = rec.isLastDay ? 31 : (rec.dayOfMonth || 15);
                nextDate.setMonth(nextDate.getMonth() + (rec.interval || 1));
                nextDate.setDate(1);
                if (targetDay === 31 || rec.isLastDay) {
                    // Last day of the new month
                    nextDate.setMonth(nextDate.getMonth() + 1);
                    nextDate.setDate(0);
                } else {
                    // Clamp to valid day
                    const maxDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
                    nextDate.setDate(Math.min(targetDay, maxDay));
                }
            }
            nextDate.setHours(0,0,0,0);
            return nextDate;
        }

        function handleRecurrenceOnCompletion(card) {
            const rec = card.recurrence;
            if (!rec || rec.type === 'none' || rec.type === 'dependent') return;

            // Check end condition
            if (rec.endType === 'after') {
                // Count existing completions of this recurrence series
                const completedCount = state.cards.filter(c => 
                    c.completionNote && c.title === card.title && c.category === card.category
                ).length;
                if (completedCount >= (rec.endAfter || 10)) {
                    showToast('Récurrence terminée (' + (rec.endAfter || 10) + ' occurrences atteintes)');
                    return;
                }
            }
            if (rec.endType === 'onDate' && rec.endDate) {
                const endDate = new Date(rec.endDate + 'T00:00:00');
                if (new Date() >= endDate) {
                    showToast('Récurrence terminée (date de fin atteinte)');
                    return;
                }
            }

            const newTask = {
                ...card,
                id: state.nextCardId++,
                completionNote: null,
                completedAt: null,
                timeHistory: [],
                totalTimeSpent: 0,
                createdAt: new Date().toISOString()
            };
            
            newTask.checklist = (newTask.checklist || []).map(item => ({...item, checked: false}));

            const nextDate = getNextRecurrenceDate(card);
            if (nextDate) {
                const y = nextDate.getFullYear();
                const m = String(nextDate.getMonth() + 1).padStart(2, '0');
                const d = String(nextDate.getDate()).padStart(2, '0');
                const isoDate = `${y}-${m}-${d}`;
                newTask.startDate = isoDate;
                if (card.deadline) {
                    // Maintain relative offset between start and deadline
                    const oldStart = card.startDate ? new Date(card.startDate + 'T00:00:00') : new Date();
                    const oldDeadline = new Date(card.deadline + 'T00:00:00');
                    const offsetDays = Math.round((oldDeadline - oldStart) / 86400000);
                    const newDeadline = new Date(nextDate);
                    newDeadline.setDate(newDeadline.getDate() + offsetDays);
                    newTask.deadline = `${newDeadline.getFullYear()}-${String(newDeadline.getMonth()+1).padStart(2,'0')}-${String(newDeadline.getDate()).padStart(2,'0')}`;
                }
                if (card.scheduledTime) {
                    newTask.scheduledTime = card.scheduledTime;
                }
            }

            const todayCol = findColumnByRole('today') || state.columns[0];
            newTask.columnId = todayCol.id;
            
            // Force routing based on new start date for tomorrow/next-week/next-month columns
            const routed = autoRouteTask(newTask);
            if (!routed && newTask.startDate) {
                // If autoRoute didn't change the column, verify it's correct
                const expectedTarget = getTargetColumnForDate(newTask.startDate);
                if (expectedTarget && expectedTarget !== 'today' && expectedTarget !== 'later-this-week') {
                    const futureCol = findColumnByRole(expectedTarget);
                    if (futureCol && futureCol.id !== newTask.columnId) {
                        newTask.columnId = futureCol.id;
                    }
                }
            }

            state.cards.push(newTask);
            showToast('Tâche récurrente recréée ↻');
        }

        function handleDependenciesOnCompletion(card) {
            state.cards.forEach(c => {
                const rec = c.recurrence;
                if (rec && rec.type === 'dependent' && rec.dependencyId === card.id) {
                    const todayCol = findColumnByRole('today');
                    if (todayCol && c.columnId !== todayCol.id) {
                        const col = state.columns.find(col => col.id === c.columnId);
                        if (!isCompletedColumn(col)) {
                            c.columnId = todayCol.id;
                            showToast(`Tâche déclenchée : ${c.title}`);
                        }
                    }
                }
            });
        }

        // =========== TIMELINE COLLISION ============
        function getCardTimeWindow(card) {
            const date = card.startDate || card.deadline;
            if (!date || !card.scheduledTime) return null;
            const [h, m] = card.scheduledTime.split(':').map(Number);
            const startMins = h * 60 + m;
            const duration = card.duration ? parseInt(card.duration) : 60;
            return { date, start: startMins, end: startMins + duration };
        }

        function checkTimelineCollisions(cardData, excludeId = null) {
            const windowA = getCardTimeWindow(cardData);
            if (!windowA) return [];

            const conflicts = [];
            state.cards.forEach(c => {
                if (excludeId && c.id === excludeId) return;
                const col = state.columns.find(col => col.id === c.columnId);
                if (isCompletedColumn(col)) return;

                const windowB = getCardTimeWindow(c);
                if (!windowB) return;

                if (windowA.date === windowB.date) {
                    if (windowA.start < windowB.end && windowA.end > windowB.start) {
                        conflicts.push(c);
                    }
                }
            });
            return conflicts;
        }

        function formatTimeWindow(window) {
            if (!window) return '';
            const sh = Math.floor(window.start / 60).toString().padStart(2, '0');
            const sm = (window.start % 60).toString().padStart(2, '0');
            const eh = Math.floor(window.end / 60).toString().padStart(2, '0');
            const em = (window.end % 60).toString().padStart(2, '0');
            return `${sh}:${sm} - ${eh}:${em}`;
        }

        function findFreeTimeSlots(date, duration, excludeId = null) {
            if (!date) return [];
            duration = duration || 60;

            const dayTasks = state.cards.filter(c => {
                if (excludeId && c.id === excludeId) return false;
                const col = state.columns.find(col => col.id === c.columnId);
                if (isCompletedColumn(col)) return false;
                const win = getCardTimeWindow(c);
                return win && win.date === date;
            });

            let busySlots = dayTasks.map(c => {
                const win = getCardTimeWindow(c);
                return { start: win.start, end: win.end };
            });

            busySlots.sort((a, b) => a.start - b.start);
            const mergedBusy = [];
            if (busySlots.length > 0) {
                let current = busySlots[0];
                for (let i = 1; i < busySlots.length; i++) {
                    if (busySlots[i].start <= current.end) {
                        current.end = Math.max(current.end, busySlots[i].end);
                    } else {
                        mergedBusy.push(current);
                        current = busySlots[i];
                    }
                }
                mergedBusy.push(current);
            }

            const freeSlots = [];
            let searchStart = 8 * 60;
            const searchEnd = 22 * 60;

            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
            
            if (date === todayStr) {
                const nowMins = today.getHours() * 60 + today.getMinutes();
                const next15 = Math.ceil(nowMins / 15) * 15;
                searchStart = Math.max(searchStart, next15);
            }

            let current = searchStart;
            for (const block of mergedBusy) {
                if (block.start - current >= duration && (current + duration) <= searchEnd) {
                    freeSlots.push({ start: current, end: current + duration });
                }
                current = Math.max(current, block.end);
            }
            
            if (searchEnd - current >= duration) {
                freeSlots.push({ start: current, end: current + duration });
            }

            return freeSlots.slice(0, 4);
        }

        function formatTimeWindowFromMins(startMins, endMins) {
            const sh = Math.floor(startMins / 60).toString().padStart(2, '0');
            const sm = (startMins % 60).toString().padStart(2, '0');
            const eh = Math.floor(endMins / 60).toString().padStart(2, '0');
            const em = (endMins % 60).toString().padStart(2, '0');
            return { text: `${sh}:${sm} - ${eh}:${em}`, startStr: `${sh}:${sm}` };
        }

        window.applyTimeSuggestion = function(timeStr) {
            const timeInput = document.getElementById('card-scheduled-time');
            if(timeInput) timeInput.value = timeStr;
            closeModal();
            showToast("Heure suggérée appliquée.");
        };

        // =========== CARD MANAGEMENT ============
        function showAddCardModal(columnId) {
            const todayStr = new Date().toISOString().split('T')[0];
            const modal = createModal('Nouvelle tâche', `
                <div class="form-section-header" style="margin-top:0;">Informations</div>
                <div class="form-group">
                    <label class="form-label-v2">Titre</label>
                    <input type="text" class="form-input" id="card-title" placeholder="Titre de la tâche" autofocus oninput="validateTitle()">
                    <div class="field-hint" id="title-hint"></div>
                </div>
                <div class="form-group">
                    <label class="form-label-v2">Description <span class="hint">optionnelle</span></label>
                    <textarea class="form-textarea" id="card-description" placeholder="Notes, détails, liens utiles…" rows="3"></textarea>
                </div>

                <div class="form-section-header">Planification</div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label-v2">Date</label>
                        <input type="date" class="form-input" id="card-start-date" value="${todayStr}">
                    </div>
                    <div class="form-group">
                        <label class="form-label-v2">Horaire</label>
                        <input type="time" class="form-input" id="card-scheduled-time">
                    </div>
                </div>
                <div class="deadline-toggle-row">
                    <input type="checkbox" id="card-has-deadline" onchange="toggleDeadlineField()" style="width:18px;height:18px;accent-color:var(--blue);cursor:pointer;">
                    <label class="toggle-label" for="card-has-deadline">Définir une date limite distincte</label>
                </div>
                <div id="deadline-field-container" style="display:none; margin-top:var(--space-3);">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label-v2">Date limite</label>
                        <input type="date" class="form-input" id="card-deadline">
                    </div>
                </div>

                <div class="form-section-header">Priorité</div>
                <div class="segmented-control" id="create-priority-seg">
                    <button class="seg-option" data-priority="low" onclick="setCardPriority('low','create')">
                        <span class="seg-priority-dot low"></span> Basse
                    </button>
                    <button class="seg-option active" data-priority="medium" onclick="setCardPriority('medium','create')">
                        <span class="seg-priority-dot medium"></span> Moyenne
                    </button>
                    <button class="seg-option" data-priority="high" onclick="setCardPriority('high','create')">
                        <span class="seg-priority-dot high"></span> Haute
                    </button>
                </div>
                <input type="hidden" id="card-priority" value="medium">

                <button class="advanced-toggle" id="advanced-toggle-btn" onclick="toggleAdvancedSection()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    Plus d'options
                </button>

                <div class="advanced-section" id="advanced-section">
                    <div class="form-section-header" style="margin-top:0;">Catégorie</div>
                    <div class="category-pills" id="category-pills">
                    </div>
                    <input type="hidden" id="card-category" value="">
                    <input type="hidden" id="card-category-color" value="">

                    <div class="form-section-header">Durée estimée</div>
                    <div class="duration-pills" id="duration-pills">
                        <button class="duration-pill" data-mins="15" onclick="setCardDuration(15)">15 min</button>
                        <button class="duration-pill" data-mins="30" onclick="setCardDuration(30)">30 min</button>
                        <button class="duration-pill active" data-mins="60" onclick="setCardDuration(60)">1 h</button>
                        <button class="duration-pill" data-mins="120" onclick="setCardDuration(120)">2 h</button>
                        <button class="duration-pill" data-mins="240" onclick="setCardDuration(240)">4 h</button>
                    </div>
                    <div class="duration-stepper">
                        <button class="stepper-btn" onclick="stepDuration(-15)">−</button>
                        <span class="stepper-value" id="duration-stepper-value">1 h 00</span>
                        <button class="stepper-btn" onclick="stepDuration(15)">+</button>
                    </div>
                    <input type="hidden" id="card-duration" value="60">

                    <div class="form-section-header">Récurrence</div>
                    <div class="segmented-control rec-freq-picker" id="rec-freq-picker">
                        <button class="seg-option active" data-freq="none" onclick="setRecurrenceFreq('none')">Aucune</button>
                        <button class="seg-option" data-freq="daily" onclick="setRecurrenceFreq('daily')">Jour</button>
                        <button class="seg-option" data-freq="weekly" onclick="setRecurrenceFreq('weekly')">Semaine</button>
                        <button class="seg-option" data-freq="monthly" onclick="setRecurrenceFreq('monthly')">Mois</button>
                    </div>
                    <div class="rec-panel rec-hidden" id="rec-panel">
                        <div class="rec-interval-row">
                            <span>Tous les</span>
                            <button class="stepper-btn" onclick="stepRecInterval(-1)">−</button>
                            <span class="rec-interval-value" id="rec-interval-value">1</span>
                            <button class="stepper-btn" onclick="stepRecInterval(1)">+</button>
                            <span class="rec-interval-unit" id="rec-interval-unit">jours</span>
                        </div>

                        <div id="rec-days-row" style="display:none;">
                            <div class="rec-day-chips" id="rec-day-chips">
                                <button class="rec-day-chip" data-day="1" onclick="toggleRecDay(this)">Lu</button>
                                <button class="rec-day-chip" data-day="2" onclick="toggleRecDay(this)">Ma</button>
                                <button class="rec-day-chip" data-day="3" onclick="toggleRecDay(this)">Me</button>
                                <button class="rec-day-chip" data-day="4" onclick="toggleRecDay(this)">Je</button>
                                <button class="rec-day-chip" data-day="5" onclick="toggleRecDay(this)">Ve</button>
                                <button class="rec-day-chip" data-day="6" onclick="toggleRecDay(this)">Sa</button>
                                <button class="rec-day-chip" data-day="7" onclick="toggleRecDay(this)">Di</button>
                            </div>
                        </div>

                        <div id="rec-dom-row" style="display:none;">
                            <span>Le</span>
                            <button class="stepper-btn" onclick="stepRecDom(-1)">−</button>
                            <span class="rec-interval-value" id="rec-dom-value">15</span>
                            <button class="stepper-btn" onclick="stepRecDom(1)">+</button>
                            <span>du mois</span>
                        </div>
                        <label class="rec-dom-lastday" id="rec-dom-lastday-label" style="display:none;">
                            <input type="checkbox" id="rec-dom-lastday" onchange="updateRecSummary()"> Dernier jour du mois
                        </label>

                        <div class="form-section-header" style="margin-top:var(--space-4);">Fin</div>
                        <div class="rec-end-options">
                            <label class="rec-end-option">
                                <input type="radio" name="rec-end" value="never" checked onchange="toggleRecEnd()"> Jamais
                            </label>
                            <label class="rec-end-option">
                                <input type="radio" name="rec-end" value="after" onchange="toggleRecEnd()"> Après
                                <input type="number" class="rec-end-input" id="rec-end-after" min="1" max="999" value="10" style="display:none;" oninput="updateRecSummary()"> occurrences
                            </label>
                            <label class="rec-end-option">
                                <input type="radio" name="rec-end" value="onDate" onchange="toggleRecEnd()"> Le
                                <input type="date" class="rec-end-input" id="rec-end-date" style="display:none;" onchange="updateRecSummary()">
                            </label>
                        </div>
                        <div class="rec-summary" id="rec-summary">Tous les jours</div>
                    </div>
                    <input type="hidden" id="card-recurrence-type" value="none">

                    <div class="form-section-header">Sous-tâches</div>
                    <div class="checklist-add-v2">
                        <div class="checklist-add-input-wrap">
                            <span class="checklist-add-icon">＋</span>
                            <input type="text" id="new-checklist-item" placeholder="Ajouter une sous-tâche" onkeydown="if(event.key==='Enter'){event.preventDefault();addChecklistItem();}">
                        </div>
                        <button type="button" class="checklist-add-btn" onclick="addChecklistItem()">Ajouter</button>
                    </div>
                    <div class="checklist-header-row">
                        <div class="checklist-counter" id="checklist-counter">0 sur 0</div>
                        <div class="checklist-progress"><div class="checklist-progress-fill" id="checklist-progress-fill"></div></div>
                    </div>
                    <div class="checklist-items" id="checklist-items"></div>
                </div>
            `, [
                { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                { text: 'Créer', class: 'btn-primary', onclick: `createCard(${columnId})` }
            ]);
            modal.dataset.checklist = JSON.stringify([]);
            document.body.appendChild(modal);
            initCategoryPills(null, null);
            document.getElementById('new-checklist-item').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
            });
        }

        /* --- CATEGORY PILLS SYSTEM --- */
        const PRESET_CATEGORIES = [
            { name: 'Travail',   color: '#0071E3' },
            { name: 'Personnel', color: '#AF52DE' },
            { name: 'Santé',     color: '#34C759' },
            { name: 'Courses',   color: '#FF9500' },
            { name: 'Projet',    color: '#5856D6' },
            { name: 'Admin',     color: '#8E8E93' },
            { name: 'Urgent',    color: '#FF3B30' },
            { name: 'Idée',      color: '#FFCC00' },
        ];

        function initCategoryPills(selectedName, selectedColor) {
            const container = document.getElementById('category-pills');
            if (!container) return;
            let html = PRESET_CATEGORIES.map(cat => {
                const isActive = selectedName === cat.name;
                return `<button class="category-pill${isActive ? ' active' : ''}" data-cat="${escapeHtml(cat.name)}" data-color="${cat.color}" style="--pill-color:${cat.color};" onclick="selectCategoryPill('${escapeHtml(cat.name)}','${cat.color}')">
                    <span class="category-pill-dot" style="background:${cat.color};"></span>${escapeHtml(cat.name)}
                </button>`;
            }).join('');
            html += `<button class="category-pill-new" onclick="addCustomCategory()" title="Nouvelle catégorie">+</button>`;
            container.innerHTML = html;
        }

        function selectCategoryPill(name, color) {
            document.querySelectorAll('#category-pills .category-pill').forEach(b => b.classList.remove('active'));
            const btn = document.querySelector(`#category-pills .category-pill[data-cat="${escapeHtml(name)}"]`);
            if (btn) btn.classList.add('active');
            const nameInput = document.getElementById('card-category');
            const colorInput = document.getElementById('card-category-color');
            if (nameInput) nameInput.value = name;
            if (colorInput) colorInput.value = color;
        }

        function addCustomCategory() {
            const name = prompt('Nom de la nouvelle catégorie :');
            if (!name || !name.trim()) return;
            const cleanName = name.trim();
            const existing = PRESET_CATEGORIES.find(c => c.name.toLowerCase() === cleanName.toLowerCase());
            if (existing) {
                selectCategoryPill(existing.name, existing.color);
                return;
            }
            const colors = ['#0071E3','#AF52DE','#34C759','#FF9500','#5856D6','#FF3B30','#FFCC00','#00C7BE','#FF6482','#32ADE6','#8E8E93'];
            const notUsed = colors.find(c => !PRESET_CATEGORIES.some(p => p.color === c)) || colors[PRESET_CATEGORIES.length % colors.length];
            PRESET_CATEGORIES.push({ name: cleanName, color: notUsed });
            const nameInput = document.getElementById('card-category');
            const colorInput = document.getElementById('card-category-color');
            const currentName = nameInput ? nameInput.value : null;
            const currentColor = colorInput ? colorInput.value : null;
            initCategoryPills(currentName || cleanName, currentColor || notUsed);
            selectCategoryPill(cleanName, notUsed);
        }

        /* --- PRIORITY SEGMENTED CONTROL --- */
        function setCardPriority(priority, mode) {
            const prefix = mode === 'edit' ? 'edit-' : 'create-';
            const seg = document.getElementById(prefix + 'priority-seg');
            if (seg) {
                seg.querySelectorAll('.seg-option').forEach(b => b.classList.remove('active'));
                const btn = seg.querySelector(`[data-priority="${priority}"]`);
                if (btn) btn.classList.add('active');
            }
            const hidden = document.getElementById('card-priority');
            if (hidden) hidden.value = priority;
        }

        /* --- DURATION PILLS & STEPPER --- */
        let currentDuration = 60;

        function setCardDuration(mins) {
            currentDuration = mins;
            document.querySelectorAll('#duration-pills .duration-pill').forEach(p => p.classList.remove('active'));
            const pill = document.querySelector(`#duration-pills .duration-pill[data-mins="${mins}"]`);
            if (pill) pill.classList.add('active');
            updateDurationStepperDisplay();
            const hidden = document.getElementById('card-duration');
            if (hidden) hidden.value = mins;
        }

        function stepDuration(delta) {
            currentDuration = Math.max(15, currentDuration + delta);
            document.querySelectorAll('#duration-pills .duration-pill').forEach(p => p.classList.remove('active'));
            updateDurationStepperDisplay();
            const hidden = document.getElementById('card-duration');
            if (hidden) hidden.value = currentDuration;
        }

        function updateDurationStepperDisplay() {
            const el = document.getElementById('duration-stepper-value');
            if (!el) return;
            const h = Math.floor(currentDuration / 60);
            const m = currentDuration % 60;
            if (h > 0 && m > 0) el.textContent = `${h} h ${String(m).padStart(2, '0')}`;
            else if (h > 0) el.textContent = `${h} h 00`;
            else el.textContent = `${m} min`;
        }

        /* --- DEADLINE TOGGLE --- */
        function toggleDeadlineField() {
            const cb = document.getElementById('card-has-deadline');
            const container = document.getElementById('deadline-field-container');
            if (!cb || !container) return;
            if (cb.checked) {
                container.style.display = 'block';
                container.classList.add('deadline-field-enter');
            } else {
                container.style.display = 'none';
                container.classList.remove('deadline-field-enter');
                const dl = document.getElementById('card-deadline');
                if (dl) dl.value = '';
            }
        }

        /* --- ADVANCED SECTION TOGGLE --- */
        function toggleAdvancedSection() {
            const btn = document.getElementById('advanced-toggle-btn');
            const section = document.getElementById('advanced-section');
            if (!btn || !section) return;
            const isOpen = section.classList.contains('open');
            if (isOpen) {
                section.classList.remove('open');
                btn.classList.remove('expanded');
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg> Plus d'options`;
            } else {
                section.classList.add('open');
                btn.classList.add('expanded');
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg> Moins d'options`;
            }
        }

        /* --- INLINE TITLE VALIDATION --- */
        function validateTitle() {
            const input = document.getElementById('card-title');
            const hint = document.getElementById('title-hint');
            if (!input || !hint) return;
            const len = input.value.trim().length;
            hint.classList.remove('warning');
            if (len === 0) {
                hint.textContent = '';
                input.classList.remove('input-valid');
            } else if (len < 3) {
                hint.textContent = 'Le titre doit faire au moins 3 caractères';
                hint.classList.add('warning');
                input.classList.add('input-warning');
                input.classList.remove('input-valid');
            } else {
                hint.textContent = len + ' caractères';
                input.classList.add('input-valid');
                input.classList.remove('input-warning');
            }
        }

        /* --- CHECKLIST UPDATED HELPERS --- */
        // Retrouve TOUJOURS le bon modal (celui qui contient le champ sous-tâche)
        // au lieu du "premier" .modal-overlay — crucial quand plusieurs modals
        // sont empilés (récapitulatif + édition, ou conflit d'horaire).
        function getChecklistModal() {
            const input = document.getElementById('new-checklist-item');
            return input ? input.closest('.modal-overlay') : null;
        }

        function addChecklistItem() {
            const input = document.getElementById('new-checklist-item');
            const text = input.value.trim();
            if (!text) return;
            const modal = getChecklistModal();
            if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            checklist.push({ text: text, checked: false });
            modal.dataset.checklist = JSON.stringify(checklist);
            renderChecklistItems();
            input.value = '';
            input.focus();
        }

        // Rendu partagé des sous-tâches (création + édition) : compteur contextuel,
        // barre de progression, case à cocher style Apple (anneau → pastille verte).
        function renderChecklistUI(checklist, toggleFn, removeFn) {
            const container = document.getElementById('checklist-items');
            const counter = document.getElementById('checklist-counter');
            const fill = document.getElementById('checklist-progress-fill');
            if (!container) return;

            const total = checklist.length;
            const done = checklist.filter(i => i.checked).length;
            const allDone = total > 0 && done === total;

            // Compteur contextuel
            if (counter) {
                counter.textContent = total === 0 ? 'Aucune sous-tâche' : (done + ' sur ' + total);
                counter.classList.toggle('is-complete', allDone);
            }

            // Barre de progression
            if (fill) {
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                fill.style.setProperty('--progress', pct + '%');
                fill.classList.toggle('is-complete', allDone);
            }

            container.innerHTML = checklist.map((item, index) => `
                <div class="checklist-item-v2 ${item.checked ? 'is-checked' : ''}">
                    <div class="checklist-check" role="checkbox" aria-checked="${item.checked}" tabindex="0"
                         onclick="${toggleFn}(${index})" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();${toggleFn}(${index})}"></div>
                    <span class="checklist-text-v2">${escapeHtml(item.text)}</span>
                    <button class="checklist-del-btn" onclick="${removeFn}(${index})" title="Supprimer" aria-label="Supprimer la sous-tâche">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `).join('');
        }

        function renderChecklistItems() {
            const modal = getChecklistModal(); if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            renderChecklistUI(checklist, 'toggleNewChecklistItem', 'removeNewChecklistItem');
        }

        function toggleNewChecklistItem(index) {
            const modal = getChecklistModal(); if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            checklist[index].checked = !checklist[index].checked;
            modal.dataset.checklist = JSON.stringify(checklist);
            renderChecklistItems();
        }

        function removeNewChecklistItem(index) {
            const modal = getChecklistModal(); if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            checklist.splice(index, 1);
            modal.dataset.checklist = JSON.stringify(checklist);
            renderChecklistItems();
        }

        /* ============================================================
           RECURRENCE SYSTEM — V2 (Juillet 2026)
           ============================================================ */
        let recState = { freq: 'none', interval: 1, daysOfWeek: [], dayOfMonth: 15, isLastDay: false, endType: 'never', endAfter: 10, endDate: '' };

        function setRecurrenceFreq(freq) {
            recState.freq = freq;
            const panel = document.getElementById('rec-panel');
            const picker = document.getElementById('rec-freq-picker');
            const typeHidden = document.getElementById('card-recurrence-type');
            const daysRow = document.getElementById('rec-days-row');
            const domRow = document.getElementById('rec-dom-row');
            const domLastdayLbl = document.getElementById('rec-dom-lastday-label');
            const intervalUnit = document.getElementById('rec-interval-unit');

            // Update segmented control
            if (picker) {
                picker.querySelectorAll('.seg-option').forEach(b => b.classList.remove('active'));
                const btn = picker.querySelector(`[data-freq="${freq}"]`);
                if (btn) btn.classList.add('active');
            }

            // Show/hide panel
            if (freq === 'none') {
                if (panel) { panel.classList.add('rec-hidden'); panel.style.display = 'none'; }
                if (typeHidden) typeHidden.value = 'none';
                return;
            }
            if (panel) { panel.classList.remove('rec-hidden'); panel.style.display = ''; }

            // Unit label
            const units = { daily: 'jours', weekly: 'semaines', monthly: 'mois' };
            if (intervalUnit) intervalUnit.textContent = units[freq] || 'jours';

            // Day-of-week chips (weekly only)
            if (daysRow) daysRow.style.display = freq === 'weekly' ? '' : 'none';
            if (domRow) domRow.style.display = freq === 'monthly' ? '' : 'none';
            if (domLastdayLbl) domLastdayLbl.style.display = freq === 'monthly' ? '' : 'none';

            if (typeHidden) typeHidden.value = freq;
            updateRecSummary();
        }

        function stepRecInterval(delta) {
            recState.interval = Math.max(1, Math.min(99, recState.interval + delta));
            const el = document.getElementById('rec-interval-value');
            if (el) el.textContent = recState.interval;
            updateRecSummary();
        }

        function toggleRecDay(chip) {
            const day = parseInt(chip.dataset.day);
            const idx = recState.daysOfWeek.indexOf(day);
            if (idx >= 0) {
                recState.daysOfWeek.splice(idx, 1);
                chip.classList.remove('active');
            } else {
                recState.daysOfWeek.push(day);
                recState.daysOfWeek.sort((a,b) => a-b);
                chip.classList.add('active');
            }
            updateRecSummary();
        }

        function stepRecDom(delta) {
            recState.dayOfMonth = Math.max(1, Math.min(31, recState.dayOfMonth + delta));
            const el = document.getElementById('rec-dom-value');
            if (el) el.textContent = recState.dayOfMonth;
            document.getElementById('rec-dom-lastday').checked = false;
            recState.isLastDay = false;
            updateRecSummary();
        }

        function toggleRecEnd() {
            const afterInput = document.getElementById('rec-end-after');
            const dateInput = document.getElementById('rec-end-date');
            const radios = document.getElementsByName('rec-end');
            let selected = 'never';
            radios.forEach(r => { if (r.checked) selected = r.value; });
            recState.endType = selected;
            if (afterInput) afterInput.style.display = selected === 'after' ? '' : 'none';
            if (dateInput) dateInput.style.display = selected === 'onDate' ? '' : 'none';
            if (selected === 'after') recState.endAfter = parseInt(afterInput?.value) || 10;
            if (selected === 'onDate') recState.endDate = dateInput?.value || '';
            updateRecSummary();
        }

        /** Initialize recurrence UI from existing card data (for edit modal) */
        function initRecurrenceFromCard(card) {
            const rec = card.recurrence || { type: 'none' };
            // Handle legacy types
            let freq = rec.type || 'none';
            if (freq === 'hourly' || freq === 'advanced' || freq === 'dependent') freq = 'none'; // legacy → none by default
            recState.freq = freq;
            recState.interval = rec.interval || 1;
            recState.daysOfWeek = rec.daysOfWeek || [];
            recState.dayOfMonth = rec.dayOfMonth || 15;
            recState.isLastDay = rec.dayOfMonth === -1;
            recState.endType = rec.endType || 'never';
            recState.endAfter = rec.endAfter || 10;
            recState.endDate = rec.endDate || '';

            // Apply to UI
            const picker = document.getElementById('rec-freq-picker');
            if (picker) {
                picker.querySelectorAll('.seg-option').forEach(b => b.classList.remove('active'));
                const btn = picker.querySelector(`[data-freq="${freq}"]`);
                if (btn) btn.classList.add('active');
            }

            const panel = document.getElementById('rec-panel');
            const typeHidden = document.getElementById('card-recurrence-type');
            if (freq === 'none') {
                if (panel) { panel.classList.add('rec-hidden'); panel.style.display = 'none'; }
                if (typeHidden) typeHidden.value = 'none';
                return;
            }
            if (panel) { panel.classList.remove('rec-hidden'); panel.style.display = ''; }
            if (typeHidden) typeHidden.value = freq;

            // Interval
            const intervalEl = document.getElementById('rec-interval-value');
            if (intervalEl) intervalEl.textContent = recState.interval;
            const unitEl = document.getElementById('rec-interval-unit');
            const units = { daily: 'jours', weekly: 'semaines', monthly: 'mois' };
            if (unitEl) unitEl.textContent = units[freq] || 'jours';

            // Days row
            const daysRow = document.getElementById('rec-days-row');
            if (daysRow) daysRow.style.display = freq === 'weekly' ? '' : 'none';
            document.querySelectorAll('#rec-day-chips .rec-day-chip').forEach(chip => {
                const d = parseInt(chip.dataset.day);
                if (recState.daysOfWeek.includes(d)) chip.classList.add('active');
                else chip.classList.remove('active');
            });

            // Day-of-month row
            const domRow = document.getElementById('rec-dom-row');
            const domLastLbl = document.getElementById('rec-dom-lastday-label');
            if (domRow) domRow.style.display = freq === 'monthly' ? '' : 'none';
            if (domLastLbl) domLastLbl.style.display = freq === 'monthly' ? '' : 'none';
            const domValue = document.getElementById('rec-dom-value');
            if (domValue) domValue.textContent = recState.isLastDay ? 31 : recState.dayOfMonth;
            const lastDayCb = document.getElementById('rec-dom-lastday');
            if (lastDayCb) lastDayCb.checked = recState.isLastDay;

            // End condition
            const afterInput = document.getElementById('rec-end-after');
            const dateInput = document.getElementById('rec-end-date');
            const radios = document.getElementsByName('rec-end');
            radios.forEach(r => { r.checked = (r.value === recState.endType); });
            if (afterInput) { afterInput.value = recState.endAfter; afterInput.style.display = recState.endType === 'after' ? '' : 'none'; }
            if (dateInput) { dateInput.value = recState.endDate; dateInput.style.display = recState.endType === 'onDate' ? '' : 'none'; }

            updateRecSummary();
        }

        /** Generate natural-language recurrence summary */
        function updateRecSummary() {
            const summaryEl = document.getElementById('rec-summary');
            if (!summaryEl) return;
            const days = ['Lu','Ma','Me','Je','Ve','Sa','Di'];

            // Read dynamic state from DOM
            const freq = recState.freq;
            const interval = parseInt(document.getElementById('rec-interval-value')?.textContent) || recState.interval;
            recState.interval = interval;

            // Days of week from chips
            const activeDays = [];
            document.querySelectorAll('#rec-day-chips .rec-day-chip.active').forEach(chip => {
                activeDays.push(parseInt(chip.dataset.day));
            });
            recState.daysOfWeek = activeDays;

            // DOM value
            const domVal = parseInt(document.getElementById('rec-dom-value')?.textContent) || recState.dayOfMonth;
            recState.dayOfMonth = domVal;

            if (freq === 'none') { summaryEl.textContent = 'Aucune répétition'; return; }

            let text = 'Tous';
            if (interval > 1) text += ` les ${interval}`;
            text += ' ' + ({ daily: 'jours', weekly: 'semaines', monthly: 'mois' }[freq] || 'jours');

            if (freq === 'weekly' && activeDays.length > 0 && activeDays.length < 7) {
                text += ' — ' + activeDays.map(d => days[d-1]).join(', ');
            }
            if (freq === 'monthly') {
                const lastCb = document.getElementById('rec-dom-lastday');
                recState.isLastDay = lastCb?.checked || false;
                if (recState.isLastDay) text += ', le dernier jour';
                else text += `, le ${domVal}`;
            }

            // End condition
            const endRadios = document.getElementsByName('rec-end');
            let endType = 'never';
            endRadios.forEach(r => { if (r.checked) endType = r.value; });
            recState.endType = endType;
            if (endType === 'after') {
                const n = parseInt(document.getElementById('rec-end-after')?.value) || 10;
                recState.endAfter = n;
                text += ` · ${n} fois`;
            } else if (endType === 'onDate') {
                const d = document.getElementById('rec-end-date')?.value;
                recState.endDate = d || '';
                if (d) text += ` · jusqu'au ${d}`;
            }

            summaryEl.textContent = text;
        }

        function createCard(columnId, force = false) {
            const title = document.getElementById('card-title').value.trim();
            if (!title) {
                showToast('Le titre est obligatoire');
                return;
            }
            const formModal = getChecklistModal() || (document.getElementById('card-title') || {}).closest?.('.modal-overlay'); if (!formModal) return;
            const checklist = safeJsonParse(formModal.dataset.checklist || '[]', []);
            
            const recType = document.getElementById('card-recurrence-type').value;
            const recurrence = buildRecurrenceFromUI();

            const durInput = document.getElementById('card-duration');
            const durationVal = durInput ? parseInt(durInput.value) : null;
            const catInput = document.getElementById('card-category');
            const catColorInput = document.getElementById('card-category-color');

            const card = {
                id: state.nextCardId,
                columnId: columnId,
                title: title,
                description: document.getElementById('card-description').value.trim(),
                startDate: document.getElementById('card-start-date').value || null,
                duration: durationVal && durationVal > 0 ? durationVal : null,
                scheduledTime: document.getElementById('card-scheduled-time').value || null,
                deadline: document.getElementById('card-deadline').value || null,
                priority: document.getElementById('card-priority').value,
                category: catInput ? (catInput.value.trim() || null) : null,
                categoryColor: catColorInput ? (catColorInput.value || '#0071E3') : '#0071E3',
                recurrence: recurrence,
                checklist: checklist,
                completionNote: null,
                timeHistory: [],
                totalTimeSpent: 0,
                createdAt: new Date().toISOString()
            };
            
            if (!force) {
                const conflicts = checkTimelineCollisions(card);
                if (conflicts.length > 0) {
                    const conflictItems = conflicts.map(c => {
                        const w = getCardTimeWindow(c);
                        return `<li style="margin-bottom: var(--space-1);"><strong>${escapeHtml(c.title)}</strong> <span style="opacity:0.8">(${formatTimeWindow(w)})</span></li>`;
                    }).join('');
                    
                    const windowA = getCardTimeWindow(card);
                    let suggestionsHTML = '';
                    if (windowA) {
                        const duration = windowA.end - windowA.start;
                        const freeSlots = findFreeTimeSlots(windowA.date, duration, card.id);
                        if (freeSlots.length > 0) {
                            suggestionsHTML = `
                                <div style="margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--line);">
                                    <p style="font-size: 14px; font-weight: 600; color: #248A3D; margin-bottom: var(--space-2);">💡 Créneaux libres suggérés (${duration} min) :</p>
                                    <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
                                        ${freeSlots.map(slot => {
                                            const formatted = formatTimeWindowFromMins(slot.start, slot.end);
                                            return `<button class="btn btn-secondary" onclick="applyTimeSuggestion('${formatted.startStr}')" style="background: var(--sys-green-bg); color: #248A3D; border: 1px solid rgba(52,199,89,0.3); font-size: 13px; padding: 8px 14px;">${formatted.text}</button>`;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        } else {
                            suggestionsHTML = `
                                <div style="margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--line);">
                                    <p style="font-size: 14px; font-weight: 600; color: #B85E00; margin-bottom: var(--space-2);">⚠️ Aucun créneau libre suffisant trouvé (8h-22h).</p>
                                </div>
                            `;
                        }
                    }

                    const conflictModal = createModal('Conflit d\'horaire détecté ⚠️', `
                        <p style="margin-bottom: var(--space-3); font-size: 15px; color: var(--ink-soft); line-height: 1.4;">
                            La tâche que vous essayez de créer s'écrase avec les tâches suivantes :
                        </p>
                        <ul style="margin-bottom: var(--space-4); font-size: 14px; color: var(--sys-red); background: var(--sys-red-bg); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-6); border-radius: var(--radius);">
                            ${conflictItems}
                        </ul>
                        <p style="font-size: 15px; color: var(--ink); font-weight: 500;">Voulez-vous tout de même l'enregistrer ?</p>
                        ${suggestionsHTML}
                    `, [
                        { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                        { text: 'Forcer la création', class: 'btn-danger', onclick: `createCard(${columnId}, true)` }
                    ]);
                    document.body.appendChild(conflictModal);
                    return;
                }
            }

            card.id = state.nextCardId++;
            autoRouteTask(card);
            
            state.cards.push(card);
            saveState();
            closeAllModals();
            renderBoard();
            updateStats();
            showToast('Tâche créée');
        }

        function editCard(cardId) {
            closeCardMenu();
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const hasDeadline = !!(card.deadline && card.deadline !== (card.startDate || ''));
            const durVal = card.duration || 60;
            const modal = createModal('Modifier la tâche', `
                <div class="form-section-header" style="margin-top:0;">Informations</div>
                <div class="form-group">
                    <label class="form-label-v2">Titre</label>
                    <input type="text" class="form-input" id="card-title" value="${escapeHtml(card.title)}" autofocus oninput="validateTitle()">
                    <div class="field-hint" id="title-hint">${card.title.length} caractères</div>
                </div>
                <div class="form-group">
                    <label class="form-label-v2">Description <span class="hint">optionnelle</span></label>
                    <textarea class="form-textarea" id="card-description" rows="3">${escapeHtml(card.description || '')}</textarea>
                </div>

                <div class="form-section-header">Planification</div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label-v2">Date</label>
                        <input type="date" class="form-input" id="card-start-date" value="${card.startDate || ''}">
                    </div>
                    <div class="form-group">
                        <label class="form-label-v2">Horaire</label>
                        <input type="time" class="form-input" id="card-scheduled-time" value="${card.scheduledTime || ''}">
                    </div>
                </div>
                <div class="deadline-toggle-row">
                    <input type="checkbox" id="card-has-deadline" onchange="toggleDeadlineField()" ${hasDeadline ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--blue);cursor:pointer;">
                    <label class="toggle-label" for="card-has-deadline">Définir une date limite distincte</label>
                </div>
                <div id="deadline-field-container" style="${hasDeadline ? '' : 'display:none;'} margin-top:var(--space-3);">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label-v2">Date limite</label>
                        <input type="date" class="form-input" id="card-deadline" value="${card.deadline || ''}">
                    </div>
                </div>

                <div class="form-section-header">Priorité</div>
                <div class="segmented-control" id="edit-priority-seg">
                    <button class="seg-option${card.priority === 'low' ? ' active' : ''}" data-priority="low" onclick="setCardPriority('low','edit')">
                        <span class="seg-priority-dot low"></span> Basse
                    </button>
                    <button class="seg-option${card.priority === 'medium' ? ' active' : ''}" data-priority="medium" onclick="setCardPriority('medium','edit')">
                        <span class="seg-priority-dot medium"></span> Moyenne
                    </button>
                    <button class="seg-option${card.priority === 'high' ? ' active' : ''}" data-priority="high" onclick="setCardPriority('high','edit')">
                        <span class="seg-priority-dot high"></span> Haute
                    </button>
                </div>
                <input type="hidden" id="card-priority" value="${card.priority}">

                <button class="advanced-toggle expanded" id="advanced-toggle-btn" onclick="toggleAdvancedSection()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    Moins d'options
                </button>

                <div class="advanced-section open" id="advanced-section">
                    <div class="form-section-header" style="margin-top:0;">Catégorie</div>
                    <div class="category-pills" id="category-pills">
                    </div>
                    <input type="hidden" id="card-category" value="${escapeHtml(card.category || '')}">
                    <input type="hidden" id="card-category-color" value="${card.categoryColor || '#0071E3'}">

                    <div class="form-section-header">Durée estimée</div>
                    <div class="duration-pills" id="duration-pills">
                        <button class="duration-pill${durVal === 15 ? ' active' : ''}" data-mins="15" onclick="setCardDuration(15)">15 min</button>
                        <button class="duration-pill${durVal === 30 ? ' active' : ''}" data-mins="30" onclick="setCardDuration(30)">30 min</button>
                        <button class="duration-pill${durVal === 60 ? ' active' : ''}" data-mins="60" onclick="setCardDuration(60)">1 h</button>
                        <button class="duration-pill${durVal === 120 ? ' active' : ''}" data-mins="120" onclick="setCardDuration(120)">2 h</button>
                        <button class="duration-pill${durVal === 240 ? ' active' : ''}" data-mins="240" onclick="setCardDuration(240)">4 h</button>
                    </div>
                    <div class="duration-stepper">
                        <button class="stepper-btn" onclick="stepDuration(-15)">−</button>
                        <span class="stepper-value" id="duration-stepper-value"></span>
                        <button class="stepper-btn" onclick="stepDuration(15)">+</button>
                    </div>
                    <input type="hidden" id="card-duration" value="${durVal}">

                    <div class="form-section-header">Récurrence</div>
                    <div class="segmented-control rec-freq-picker" id="rec-freq-picker">
                        <button class="seg-option active" data-freq="none" onclick="setRecurrenceFreq('none')">Aucune</button>
                        <button class="seg-option" data-freq="daily" onclick="setRecurrenceFreq('daily')">Jour</button>
                        <button class="seg-option" data-freq="weekly" onclick="setRecurrenceFreq('weekly')">Semaine</button>
                        <button class="seg-option" data-freq="monthly" onclick="setRecurrenceFreq('monthly')">Mois</button>
                    </div>
                    <div class="rec-panel rec-hidden" id="rec-panel">
                        <div class="rec-interval-row">
                            <span>Tous les</span>
                            <button class="stepper-btn" onclick="stepRecInterval(-1)">−</button>
                            <span class="rec-interval-value" id="rec-interval-value">1</span>
                            <button class="stepper-btn" onclick="stepRecInterval(1)">+</button>
                            <span class="rec-interval-unit" id="rec-interval-unit">jours</span>
                        </div>

                        <div id="rec-days-row" style="display:none;">
                            <div class="rec-day-chips" id="rec-day-chips">
                                <button class="rec-day-chip" data-day="1" onclick="toggleRecDay(this)">Lu</button>
                                <button class="rec-day-chip" data-day="2" onclick="toggleRecDay(this)">Ma</button>
                                <button class="rec-day-chip" data-day="3" onclick="toggleRecDay(this)">Me</button>
                                <button class="rec-day-chip" data-day="4" onclick="toggleRecDay(this)">Je</button>
                                <button class="rec-day-chip" data-day="5" onclick="toggleRecDay(this)">Ve</button>
                                <button class="rec-day-chip" data-day="6" onclick="toggleRecDay(this)">Sa</button>
                                <button class="rec-day-chip" data-day="7" onclick="toggleRecDay(this)">Di</button>
                            </div>
                        </div>

                        <div id="rec-dom-row" style="display:none;">
                            <span>Le</span>
                            <button class="stepper-btn" onclick="stepRecDom(-1)">−</button>
                            <span class="rec-interval-value" id="rec-dom-value">15</span>
                            <button class="stepper-btn" onclick="stepRecDom(1)">+</button>
                            <span>du mois</span>
                        </div>
                        <label class="rec-dom-lastday" id="rec-dom-lastday-label" style="display:none;">
                            <input type="checkbox" id="rec-dom-lastday" onchange="updateRecSummary()"> Dernier jour du mois
                        </label>

                        <div class="form-section-header" style="margin-top:var(--space-4);">Fin</div>
                        <div class="rec-end-options">
                            <label class="rec-end-option">
                                <input type="radio" name="rec-end" value="never" checked onchange="toggleRecEnd()"> Jamais
                            </label>
                            <label class="rec-end-option">
                                <input type="radio" name="rec-end" value="after" onchange="toggleRecEnd()"> Après
                                <input type="number" class="rec-end-input" id="rec-end-after" min="1" max="999" value="10" style="display:none;" oninput="updateRecSummary()"> occurrences
                            </label>
                            <label class="rec-end-option">
                                <input type="radio" name="rec-end" value="onDate" onchange="toggleRecEnd()"> Le
                                <input type="date" class="rec-end-input" id="rec-end-date" style="display:none;" onchange="updateRecSummary()">
                            </label>
                        </div>
                        <div class="rec-summary" id="rec-summary">Tous les jours</div>
                    </div>
                    <input type="hidden" id="card-recurrence-type" value="none">
                    <input type="hidden" id="card-id-hidden" value="${card.id}">

                    <div class="form-section-header">Sous-tâches</div>
                    <div class="checklist-add-v2">
                        <div class="checklist-add-input-wrap">
                            <span class="checklist-add-icon">＋</span>
                            <input type="text" id="new-checklist-item" placeholder="Ajouter une sous-tâche" onkeydown="if(event.key==='Enter'){event.preventDefault();addEditChecklistItem();}">
                        </div>
                        <button type="button" class="checklist-add-btn" onclick="addEditChecklistItem()">Ajouter</button>
                    </div>
                    <div class="checklist-header-row">
                        <div class="checklist-counter" id="checklist-counter">${(card.checklist || []).length} sous-tâche${(card.checklist || []).length !== 1 ? 's' : ''}</div>
                        <div class="checklist-progress"><div class="checklist-progress-fill" id="checklist-progress-fill"></div></div>
                    </div>
                    <div class="checklist-items" id="checklist-items"></div>
                </div>
            `, [
                { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                { text: 'Enregistrer', class: 'btn-primary', onclick: `updateCard(${cardId})` }
            ]);
            modal.dataset.checklist = JSON.stringify(card.checklist || []);
            document.body.appendChild(modal);
            initCategoryPills(card.category || null, card.categoryColor || null);
            currentDuration = durVal;
            updateDurationStepperDisplay();
            initRecurrenceFromCard(card);
            renderEditChecklistItems();
            document.getElementById('new-checklist-item').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addEditChecklistItem(); }
            });
        }

        function addEditChecklistItem() {
            const input = document.getElementById('new-checklist-item');
            const text = input.value.trim();
            if (!text) return;
            const modal = getChecklistModal();
            if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            checklist.push({ text: text, checked: false });
            modal.dataset.checklist = JSON.stringify(checklist);
            renderEditChecklistItems();
            input.value = '';
            input.focus();
        }

        function renderEditChecklistItems() {
            const modal = getChecklistModal(); if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            renderChecklistUI(checklist, 'toggleEditChecklistItem', 'removeEditChecklistItem');
        }

        function toggleEditChecklistItem(index) {
            const modal = getChecklistModal(); if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            checklist[index].checked = !checklist[index].checked;
            modal.dataset.checklist = JSON.stringify(checklist);
            renderEditChecklistItems();
        }

        function removeEditChecklistItem(index) {
            const modal = getChecklistModal(); if (!modal) return;
            const checklist = safeJsonParse(modal.dataset.checklist || '[]', []);
            checklist.splice(index, 1);
            modal.dataset.checklist = JSON.stringify(checklist);
            renderEditChecklistItems();
        }

        function updateCard(cardId, force = false) {
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const formModal = getChecklistModal() || (document.getElementById('card-title') || {}).closest?.('.modal-overlay'); if (!formModal) return;
            const checklist = safeJsonParse(formModal.dataset.checklist || '[]', []);
            
            const recType = document.getElementById('card-recurrence-type').value;
            const recurrence = buildRecurrenceFromUI();

            const durInput = document.getElementById('card-duration');
            const durationVal = durInput ? parseInt(durInput.value) : null;
            const catInput = document.getElementById('card-category');
            const catColorInput = document.getElementById('card-category-color');

            const tempCard = {
                ...card,
                title: document.getElementById('card-title').value.trim(),
                description: document.getElementById('card-description').value.trim(),
                startDate: document.getElementById('card-start-date').value || null,
                duration: durationVal && durationVal > 0 ? durationVal : null,
                scheduledTime: document.getElementById('card-scheduled-time').value || null,
                deadline: document.getElementById('card-deadline').value || null,
                priority: document.getElementById('card-priority').value,
                category: catInput ? (catInput.value.trim() || null) : null,
                categoryColor: catColorInput ? (catColorInput.value || '#0071E3') : '#0071E3',
                recurrence: recurrence,
                checklist: checklist
            };

            if (!force) {
                const conflicts = checkTimelineCollisions(tempCard, cardId);
                if (conflicts.length > 0) {
                    const conflictItems = conflicts.map(c => {
                        const w = getCardTimeWindow(c);
                        return `<li style="margin-bottom: var(--space-1);"><strong>${escapeHtml(c.title)}</strong> <span style="opacity:0.8">(${formatTimeWindow(w)})</span></li>`;
                    }).join('');
                    
                    const windowA = getCardTimeWindow(tempCard);
                    let suggestionsHTML = '';
                    if (windowA) {
                        const duration = windowA.end - windowA.start;
                        const freeSlots = findFreeTimeSlots(windowA.date, duration, cardId);
                        if (freeSlots.length > 0) {
                            suggestionsHTML = `
                                <div style="margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--line);">
                                    <p style="font-size: 14px; font-weight: 600; color: #248A3D; margin-bottom: var(--space-2);">💡 Créneaux libres suggérés (${duration} min) :</p>
                                    <div style="display: flex; gap: var(--space-2); flex-wrap: wrap;">
                                        ${freeSlots.map(slot => {
                                            const formatted = formatTimeWindowFromMins(slot.start, slot.end);
                                            return `<button class="btn btn-secondary" onclick="applyTimeSuggestion('${formatted.startStr}')" style="background: var(--sys-green-bg); color: #248A3D; border: 1px solid rgba(52,199,89,0.3); font-size: 13px; padding: 8px 14px;">${formatted.text}</button>`;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        } else {
                            suggestionsHTML = `
                                <div style="margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--line);">
                                    <p style="font-size: 14px; font-weight: 600; color: #B85E00; margin-bottom: var(--space-2);">⚠️ Aucun créneau libre suffisant trouvé (8h-22h).</p>
                                </div>
                            `;
                        }
                    }

                    const conflictModal = createModal('Conflit d\'horaire détecté ⚠️', `
                        <p style="margin-bottom: var(--space-3); font-size: 15px; color: var(--ink-soft); line-height: 1.4;">
                            La tâche que vous essayez de modifier s'écrase avec les tâches suivantes :
                        </p>
                        <ul style="margin-bottom: var(--space-4); font-size: 14px; color: var(--sys-red); background: var(--sys-red-bg); padding: var(--space-3) var(--space-3) var(--space-3) var(--space-6); border-radius: var(--radius);">
                            ${conflictItems}
                        </ul>
                        <p style="font-size: 15px; color: var(--ink); font-weight: 500;">Voulez-vous tout de même l'enregistrer ?</p>
                        ${suggestionsHTML}
                    `, [
                        { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                        { text: 'Forcer la modification', class: 'btn-danger', onclick: `updateCard(${cardId}, true)` }
                    ]);
                    document.body.appendChild(conflictModal);
                    return;
                }
            }

            Object.assign(card, tempCard);
            autoRouteTask(card);
            
            saveState();
            closeAllModals();
            renderBoard();
            updateStats();
            showToast('Tâche mise à jour');
        }

        function duplicateCard(cardId) {
            closeCardMenu();
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            const newCard = {
                ...card,
                id: state.nextCardId++,
                title: card.title + ' (copie)',
                columnId: card.columnId,
                completionNote: null,
                timeHistory: [],
                totalTimeSpent: 0,
                createdAt: new Date().toISOString()
            };
            delete newCard.completedAt;
            state.cards.push(newCard);
            saveState();
            renderBoard();
            updateStats();
            showToast('Tâche dupliquée');
        }

        function deleteCard(cardId) {
            closeCardMenu();
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;

            if (card.recurrence && card.recurrence.type !== 'none' && card.recurrence.type !== 'dependent') {
                const modal = createModal('Supprimer la tâche', `
                    <p style="margin-bottom: var(--space-4); font-size: 15px; color: var(--ink-soft); line-height: 1.4;">
                        Cette tâche est <strong>récurrente</strong>. Voulez-vous supprimer uniquement cette occurrence, ou supprimer définitivement toute la série ?
                    </p>
                `, [
                    { text: 'Annuler', class: 'btn-secondary', onclick: 'closeModal()' },
                    { text: 'Uniquement celle-ci', class: 'btn-warning', onclick: `executeDeleteCard(${cardId}, 'single')` },
                    { text: 'Toute la série', class: 'btn-danger', onclick: `executeDeleteCard(${cardId}, 'all')` }
                ]);
                document.body.appendChild(modal);
            } else {
                if (!confirm('Supprimer cette tâche ?')) return;
                executeDeleteCard(cardId, 'all');
            }
        }

        function executeDeleteCard(cardId, mode) {
            const card = state.cards.find(c => c.id === cardId);
            if (!card) return;
            
            if (activeTimers[cardId]) stopTimer(cardId);

            if (mode === 'single') {
                handleRecurrenceOnCompletion(card);
            }

            state.cards = state.cards.filter(c => c.id !== cardId);
            saveState();
            closeModal();
            renderBoard();
            updateStats();
            showToast('Tâche supprimée');
        }

        // =========== RESET DAY ============
        function resetDay() {
            const modal = createModal('Clôturer la journée', `
                <p style="margin-bottom: var(--space-4); font-size: 15px; color: var(--ink-soft);">Comment souhaitez-vous gérer les tâches non terminées ?</p>
                <div style="display: flex; gap: var(--space-3); flex-direction: column;">
                    <button class="btn btn-secondary" onclick="executeResetDay('keep')" style="justify-content: flex-start; padding: var(--space-4) var(--space-4);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7; margin-right:var(--space-3)"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                        Archiver les terminées et conserver le reste
                    </button>
                    <button class="btn btn-danger" onclick="executeResetDay('delete')" style="justify-content: flex-start; padding: var(--space-4) var(--space-4);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7; margin-right:var(--space-3)"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        Archiver les terminées et supprimer le reste
                    </button>
                </div>
                <p style="margin-top: var(--space-4); font-size: 13px; color: var(--ink-soft);">
                    Les tâches terminées seront déplacées dans l'historique.<br>
                    Les tâches récurrentes sont déjà gérées automatiquement lors de leur complétion.
                </p>
            `, []);
            document.body.appendChild(modal);
        }

        function executeResetDay(action) {
            stopAllTimers();
            const today = new Date().toISOString().split('T')[0];
            
            const completedTasks = state.cards.filter(c => {
                const col = state.columns.find(col => col.id === c.columnId);
                return isCompletedColumn(col);
            });
            
            if (completedTasks.length > 0) {
                archive.unshift({
                    date: today,
                    completed: completedTasks.length,
                    total: state.cards.length,
                    tasks: completedTasks.map(c => ({
                        title: c.title,
                        priority: c.priority,
                        category: c.category,
                        totalTimeSpent: c.totalTimeSpent || 0
                    }))
                });
                if (archive.length > 30) archive = archive.slice(0, 30);
                saveArchive();
            }

            if (action === 'keep') {
                state.cards = state.cards.filter(c => {
                    const col = state.columns.find(col => col.id === c.columnId);
                    return !isCompletedColumn(col);
                });
            } else if (action === 'delete') {
                state.cards = [];
            }

            saveState();
            closeModal();
            renderBoard();
            updateStats();
            showToast('Journée clôturée avec succès');
        }

        // =========== STATISTICS ============
        function updateStats() {
            const completedCol = findColumnByRole('completed');
            const tomorrowCol = findColumnByRole('tomorrow');
            const todayCol = findColumnByRole('today');

            const completed = completedCol ? state.cards.filter(c => c.columnId === completedCol.id).length : 0;
            const tomorrow = tomorrowCol ? state.cards.filter(c => c.columnId === tomorrowCol.id).length : 0;
            const today = todayCol ? state.cards.filter(c => c.columnId === todayCol.id).length : 0;

            let overdue = 0;
            state.cards.forEach(card => {
                const col = state.columns.find(c => c.id === card.columnId);
                if (!isCompletedColumn(col)) {
                    if (getDeadlineStatus(card.deadline, card.scheduledTime) === 'overdue') overdue++;
                }
            });

            animateStatNumber('stat-completed', completed);
            animateStatNumber('stat-progress', tomorrow);
            animateStatNumber('stat-todo', today);
            animateStatNumber('stat-overdue', overdue);
        }

        // =========== EXPORT CSV ============
        function exportCSV() {
            try {
                const today = new Date().toISOString().split('T')[0];
                let csv = '\ufeff';
                csv += 'Titre,Description,Date début,Durée (min),Colonne,Priorité,Catégorie,Horaire,Date limite,Récurrent,Checklist,Note de complétion,Temps total (s)\n';
                state.cards.forEach(card => {
                    const col = state.columns.find(c => c.id === card.columnId);
                    const checklistSummary = card.checklist && card.checklist.length > 0
                        ? `${card.checklist.filter(i => i.checked).length}/${card.checklist.length} complété`
                        : '';
                    const recStr = card.recurrence && card.recurrence.type !== 'none' ? card.recurrence.type : 'Non';
                    const liveSession = activeTimers[card.id] && activeTimers[card.id].startTime ? Math.floor((Date.now() - activeTimers[card.id].startTime) / 1000) : 0;
                    const totalSecs = (card.totalTimeSpent || 0) + liveSession;
                    csv += `"${escapeCsv(card.title)}","${escapeCsv(card.description || '')}","${card.startDate || ''}","${card.duration || ''}","${col ? col.title : ''}","${card.priority}","${card.category || ''}","${card.scheduledTime || ''}","${card.deadline || ''}","${recStr}","${checklistSummary}","${escapeCsv(card.completionNote || '')}","${totalSecs}"\n`;
                });
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `taches_${today}.csv`;
                link.click();
                showToast('Export CSV téléchargé');
            } catch (error) {
                console.error('Erreur export:', error);
                showToast('Erreur lors de l\'export CSV');
            }
        }

        // =========== ARCHIVE ============
        function toggleArchive() {
            const panel = document.getElementById('archive-panel');
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) renderArchive();
        }

        function renderArchive() {
            const content = document.getElementById('archive-content');
            if (archive.length === 0) {
                content.innerHTML = '<p style="color: var(--ink-soft); text-align: center; padding: var(--space-10); font-size: 15px;">Aucune archive pour le moment</p>';
                return;
            }
            content.innerHTML = archive.map(day => `
                <div class="archive-day">
                    <div class="archive-date">${escapeHtml(day.date)}</div>
                    <div class="archive-stats">
                        <span>${day.completed} terminées</span>
                        <span>${day.total} total</span>
                        <span>${day.total > 0 ? Math.round((day.completed / day.total) * 100) : 0}%</span>
                    </div>
                </div>
            `).join('');
        }

        // =========== CALENDAR SYSTEM ============
        function switchView(view) {
            if (view === 'day') {
                openDaySummary();
                return;
            }
            currentView = view;
            const boardContainer = document.querySelector('.board-container');
            const calendarContainer = document.getElementById('calendar-container');
            const boardBtn = document.getElementById('view-board-btn');
            const calBtn = document.getElementById('view-calendar-btn');
            const dayBtn = document.getElementById('view-day-btn');

            if (boardContainer) { boardContainer.style.display = 'none'; boardContainer.classList.add('is-hidden'); boardContainer.classList.remove('view-entering'); }
            if (calendarContainer) { calendarContainer.style.display = 'none'; calendarContainer.classList.add('is-hidden'); calendarContainer.classList.remove('is-visible', 'view-entering'); }
            if (boardBtn) boardBtn.classList.remove('active');
            if (calBtn) calBtn.classList.remove('active');
            if (dayBtn) dayBtn.classList.remove('active');

            if (view === 'board') {
                if (boardContainer) { boardContainer.style.display = ''; boardContainer.classList.remove('is-hidden'); boardContainer.classList.add('view-entering'); }
                if (boardBtn) boardBtn.classList.add('active');
                renderBoard();
                setTimeout(() => boardContainer && boardContainer.classList.remove('view-entering'), 400);
            } else {
                if (calendarContainer) { calendarContainer.style.display = 'block'; calendarContainer.classList.remove('is-hidden'); calendarContainer.classList.add('is-visible', 'view-entering'); calendarContainer.scrollTop = 0; }
                if (calBtn) calBtn.classList.add('active');
                renderCalendar();
                setTimeout(() => calendarContainer && calendarContainer.classList.remove('view-entering'), 400);
            }
        }

        function prevMonth()

 {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            const cal = document.getElementById('calendar-container');
            if (cal) cal.scrollTop = 0;
            renderCalendar('prev');
        }

        function nextMonth() {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            const cal = document.getElementById('calendar-container');
            if (cal) cal.scrollTop = 0;
            renderCalendar('next');
        }

        function renderCalendar(animDirection = '') {
            const grid = document.getElementById('calendar-grid');
            const header = document.getElementById('calendar-month-year');

            if (!grid || !header) return;

            const year = currentCalendarDate.getFullYear();
            const month = currentCalendarDate.getMonth();

            const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
            header.textContent = `${monthNames[month]} ${year}`;

            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const daysInMonth = lastDay.getDate();

            let startingDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

            const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
            let html = dayNames.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

            const today = new Date();
            const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
            const currentDay = today.getDate();

            const prevMonthLast = new Date(year, month, 0);
            const prevMonthDays = prevMonthLast.getDate();
            const prevMonth = month === 0 ? 11 : month - 1;
            const prevYear = month === 0 ? year - 1 : year;
            const nextMonth = month === 11 ? 0 : month + 1;
            const nextYear = month === 11 ? year + 1 : year;

            function cellDateStr(y, m0, d) {
                return `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            }

            function tasksForDate(dateStr) {
                const dayTasks = state.cards.filter(c => {
                    const d = c.startDate || c.deadline;
                    return d === dateStr;
                });
                dayTasks.sort((a, b) => {
                    const timeA = a.scheduledTime || '23:59';
                    const timeB = b.scheduledTime || '23:59';
                    return timeA.localeCompare(timeB);
                });
                return dayTasks;
            }

            function renderDayCell({ day, dateStr, isToday, outside, dayNameStr }) {
                const dayTasks = tasksForDate(dateStr);
                const MAX_VISIBLE_TASKS = 4;
                const visibleTasks = dayTasks.slice(0, MAX_VISIBLE_TASKS);
                const extraCount = dayTasks.length - visibleTasks.length;
                const cellClass = [
                    'calendar-cell',
                    isToday ? 'today' : '',
                    outside ? 'outside-month' : ''
                ].filter(Boolean).join(' ');

                return `<div class="${cellClass}" data-date="${dateStr}">
                    <div class="calendar-date" data-day-name="${dayNameStr}">${day}</div>
                    <div class="calendar-tasks">
                        ${visibleTasks.map(c => {
                            const col = state.columns.find(col => col.id === c.columnId);
                            const isCompleted = isCompletedColumn(col);
                            const color = c.categoryColor || (col ? col.color : 'var(--blue)');
                            const label = (c.scheduledTime ? c.scheduledTime + ' · ' : '') + (c.title || '');
                            return `<div class="calendar-task ${isCompleted ? 'completed' : ''}" style="border-left-color: ${color};" title="${escapeHtml(label)}" onclick="event.stopPropagation(); showTaskSummary(${c.id})">
                                ${escapeHtml(label)}
                            </div>`;
                        }).join('')}
                        ${extraCount > 0 ? `<div class="calendar-more">+${extraCount} autre${extraCount > 1 ? 's' : ''}</div>` : ''}
                    </div>
                </div>`;
            }

            for (let i = 0; i < startingDayOfWeek; i++) {
                const day = prevMonthDays - startingDayOfWeek + 1 + i;
                const dateStr = cellDateStr(prevYear, prevMonth, day);
                const dayNameStr = dayNames[i];
                html += renderDayCell({ day, dateStr, isToday: false, outside: true, dayNameStr });
            }

            for (let day = 1; day <= daysInMonth; day++) {
                const isToday = isCurrentMonth && day === currentDay;
                const dateStr = cellDateStr(year, month, day);
                const dayNameIndex = new Date(year, month, day).getDay();
                const dayNameStr = dayNames[dayNameIndex === 0 ? 6 : dayNameIndex - 1];
                html += renderDayCell({ day, dateStr, isToday, outside: false, dayNameStr });
            }

            const totalDayCells = startingDayOfWeek + daysInMonth;
            const trailing = (7 - (totalDayCells % 7)) % 7;
            for (let i = 1; i <= trailing; i++) {
                const dateStr = cellDateStr(nextYear, nextMonth, i);
                const dow = new Date(nextYear, nextMonth, i).getDay();
                const dayNameStr = dayNames[dow === 0 ? 6 : dow - 1];
                html += renderDayCell({ day: i, dateStr, isToday: false, outside: true, dayNameStr });
            }

            grid.innerHTML = html;

            grid.classList.remove('anim-slide-prev', 'anim-slide-next');
            void grid.offsetWidth;
            if (animDirection === 'prev') grid.classList.add('anim-slide-prev');
            else if (animDirection === 'next') grid.classList.add('anim-slide-next');

            if (animDirection === 'prev' || animDirection === 'next') {
                const cleanup = () => {
                    grid.classList.remove('anim-slide-prev', 'anim-slide-next');
                    grid.removeEventListener('animationend', cleanup);
                };
                grid.addEventListener('animationend', cleanup);
                setTimeout(cleanup, 400);
            }

            updateStats();
        }


        // =========== DAY VIEW — Notification avec arrière-plan flou ===========
        function openDaySummary() {
            const overlay = document.getElementById('day-container');
            if (!overlay) return;
            overlay.style.display = 'flex';
            // Force reflow then add open
            void overlay.offsetWidth;
            overlay.classList.add('open');
            overlay.classList.remove('modal-exiting');
            document.body.style.overflow = 'hidden';
            renderDaySummary();
            // Scroll to current time or 8h
            setTimeout(() => {
                const body = document.getElementById('day-notif-body');
                if (!body) return;
                const now = new Date();
                const isToday = localDateStr(now) === localDateStr(currentDayDate);
                const targetMins = isToday ? (now.getHours()*60 + now.getMinutes()) : 8*60;
                const targetTop = ((targetMins - DAY_START_HOUR*60) / 60) * DAY_HOUR_HEIGHT;
                body.scrollTop = Math.max(0, targetTop - 200);
            }, 120);
        }

        function closeDaySummary() {
            const overlay = document.getElementById('day-container');
            if (!overlay) return;
            overlay.classList.add('modal-exiting');
            overlay.addEventListener('animationend', () => {
                overlay.classList.remove('open', 'modal-exiting');
                overlay.style.display = 'none';
                document.body.style.overflow = '';
            }, { once: true });
            setTimeout(() => {
                if (overlay.classList.contains('open') || overlay.classList.contains('modal-exiting')) {
                    overlay.classList.remove('open', 'modal-exiting');
                    overlay.style.display = 'none';
                    document.body.style.overflow = '';
                }
            }, 350);
        }

        function prevDay()
 {
            currentDayDate.setDate(currentDayDate.getDate() - 1);
            renderDaySummary();
        }

        function nextDay() {
            currentDayDate.setDate(currentDayDate.getDate() + 1);
            renderDaySummary();
        }

        function goToToday() {
            currentDayDate = new Date();
            renderDaySummary();
        }

        function goToDay(dateStr) {
            const parsed = parseLocalDate(dateStr);
            if (parsed) {
                currentDayDate = parsed;
                renderDaySummary();
            }
        }

        function getTasksForDay(dateStr) {
            const todayStr = localDateStr(new Date());
            return state.cards.filter(c => {
                const d = c.startDate || c.deadline;
                if (d === dateStr) return true;
                // Pour la vue du jour courant, inclure aussi les tâches sans date mais dans la colonne Aujourd'hui ou en retard
                if (dateStr === todayStr && !d) {
                    const col = state.columns.find(col => col.id === c.columnId);
                    if (!col) return false;
                    if (isCompletedColumn(col)) return false;
                    return isTodayColumn(col) || getDeadlineStatus(c.deadline, c.scheduledTime) === 'overdue';
                }
                return false;
            }).sort((a, b) => {
                const ta = a.scheduledTime || '23:59';
                const tb = b.scheduledTime || '23:59';
                return ta.localeCompare(tb);
            });
        }

        function formatDayHeader(dateObj) {
            const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
            const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
            const dayName = days[dateObj.getDay()];
            const day = dateObj.getDate();
            const month = months[dateObj.getMonth()];
            const year = dateObj.getFullYear();
            const today = new Date(); today.setHours(0,0,0,0);
            const cmp = new Date(dateObj); cmp.setHours(0,0,0,0);
            const diff = Math.round((cmp - today) / 86400000);
            let rel = '';
            if (diff === 0) rel = "Aujourd'hui";
            else if (diff === 1) rel = 'Demain';
            else if (diff === -1) rel = 'Hier';
            else if (diff > 0 && diff < 7) rel = `Dans ${diff} jours`;
            else if (diff < 0 && diff > -7) rel = `Il y a ${Math.abs(diff)} jours`;
            return { title: `${dayName} ${day} ${month} ${year}`, subtitle: rel };
        }

        function formatDuration(mins) {
            if (!mins || mins <= 0) return '';
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            if (h > 0 && m > 0) return `${h}h ${String(m).padStart(2,'0')}`;
            if (h > 0) return `${h}h`;
            return `${m} min`;
        }

        function computeDayOverlaps(timedTasks) {
            // Sort by start minute
            const tasks = timedTasks.map(t => {
                const [h,mm] = (t.scheduledTime || '00:00').split(':').map(Number);
                const start = h*60+mm;
                const dur = t.duration ? parseInt(t.duration) : 60;
                const end = start + dur;
                return { card: t, start, end, duration: dur };
            }).sort((a,b) => a.start - b.start || a.end - b.end);

            // Cluster overlapping tasks
            const clusters = [];
            let currentCluster = [];
            let clusterMaxEnd = -1;
            tasks.forEach(item => {
                if (currentCluster.length === 0) {
                    currentCluster = [item];
                    clusterMaxEnd = item.end;
                } else {
                    if (item.start < clusterMaxEnd) {
                        currentCluster.push(item);
                        clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
                    } else {
                        clusters.push(currentCluster);
                        currentCluster = [item];
                        clusterMaxEnd = item.end;
                    }
                }
            });
            if (currentCluster.length > 0) clusters.push(currentCluster);

            // For each cluster, assign lanes (greedy)
            const positioned = [];
            clusters.forEach(cluster => {
                const lanes = []; // each lane is array of items with last end
                cluster.forEach(item => {
                    let laneIdx = -1;
                    for (let i=0;i<lanes.length;i++) {
                        if (lanes[i].lastEnd <= item.start) { laneIdx = i; break; }
                    }
                    if (laneIdx === -1) {
                        laneIdx = lanes.length;
                        lanes.push({ lastEnd: item.end, items: [] });
                    }
                    lanes[laneIdx].lastEnd = Math.max(lanes[laneIdx].lastEnd, item.end);
                    lanes[laneIdx].items.push(item);
                    item.lane = laneIdx;
                    item.laneCount = null; // set later
                });
                const laneCount = lanes.length;
                cluster.forEach(item => { item.laneCount = laneCount; });
                positioned.push(...cluster);
            });
            return positioned;
        }

        function renderDaySummary() {
            const dayContainer = document.getElementById('day-container');
            if (!dayContainer) return;
            const dateStr = localDateStr(currentDayDate);
            const titleEl = document.getElementById('day-date-title');
            const subtitleEl = document.getElementById('day-date-subtitle');
            const pickerEl = document.getElementById('day-picker');
            const statsEl = document.getElementById('day-stats');
            const unscheduledEl = document.getElementById('day-unscheduled');
            const timelineEl = document.getElementById('day-timeline');

            if (pickerEl) pickerEl.value = dateStr;

            const header = formatDayHeader(currentDayDate);
            if (titleEl) titleEl.textContent = header.title;
            if (subtitleEl) subtitleEl.textContent = header.subtitle;

            const allDayTasks = getTasksForDay(dateStr);
            const timedTasks = allDayTasks.filter(t => !!t.scheduledTime);
            const unscheduledTasks = allDayTasks.filter(t => !t.scheduledTime);

            // Stats
            let totalMins = 0;
            timedTasks.forEach(t => totalMins += (t.duration ? parseInt(t.duration) : 60));
            const completedCol = findColumnByRole('completed');
            const completedCount = allDayTasks.filter(c => completedCol && c.columnId === completedCol.id).length;
            const remainingCount = allDayTasks.length - completedCount;
            const overdueCount = allDayTasks.filter(c => {
                const col = state.columns.find(col => col.id === c.columnId);
                if (isCompletedColumn(col)) return false;
                const s = getDeadlineStatus(c.deadline, c.scheduledTime);
                return s === 'overdue';
            }).length;

            if (statsEl) {
                const hours = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                const timeStr = hours > 0 ? `${hours}h ${mins > 0 ? String(mins).padStart(2,'0') : '00'}` : `${mins} min`;
                statsEl.innerHTML = `
                    <div class="day-stat-card">
                        <div class="day-stat-value">${allDayTasks.length}</div>
                        <div class="day-stat-label">Tâches</div>
                    </div>
                    <div class="day-stat-card">
                        <div class="day-stat-value">${timedTasks.length > 0 ? timeStr : '—'}</div>
                        <div class="day-stat-label">Temps planifié</div>
                    </div>
                    <div class="day-stat-card">
                        <div class="day-stat-value" style="color:${remainingCount>0 ? 'var(--blue)' : 'var(--ink)'}">${remainingCount}</div>
                        <div class="day-stat-label">À faire</div>
                    </div>
                    <div class="day-stat-card">
                        <div class="day-stat-value" style="color:${completedCount>0 ? 'var(--sys-green)' : 'var(--ink)'}">${completedCount}</div>
                        <div class="day-stat-label">Terminées</div>
                    </div>
                    ${overdueCount>0 ? `<div class="day-stat-card" style="border-color: rgba(255,59,48,0.3);"><div class="day-stat-value" style="color: var(--sys-red);">${overdueCount}</div><div class="day-stat-label">En retard</div></div>` : ''}
                `;
            }

            // Unscheduled
            if (unscheduledEl) {
                if (unscheduledTasks.length > 0) {
                    unscheduledEl.style.display = 'block';
                    unscheduledEl.innerHTML = `
                        <div class="day-unscheduled-title">
                            <span>Sans horaire · ${unscheduledTasks.length}</span>
                            <span style="font-weight:400; text-transform:none; font-size:11px; opacity:0.7;">Cliquer pour ouvrir</span>
                        </div>
                        <div class="day-unscheduled-list">
                            ${unscheduledTasks.map(c => {
                                const col = state.columns.find(col => col.id === c.columnId);
                                const color = c.categoryColor || (col ? col.color : 'var(--blue)');
                                const isComp = completedCol && c.columnId === completedCol.id;
                                return `<div class="day-unscheduled-chip ${isComp ? 'completed' : ''}" onclick="showTaskSummary(${c.id})" title="${escapeHtml(c.title)}">
                                    <span class="dot" style="background:${color}"></span>
                                    <span style="${isComp ? 'text-decoration:line-through; opacity:0.6;' : ''}">${escapeHtml(c.title)}</span>
                                    ${c.duration ? `<span style="font-size:10px; background:var(--bg-alt); padding:2px 6px; border-radius:6px;">${formatDuration(c.duration)}</span>` : ''}
                                </div>`;
                            }).join('')}
                        </div>
                    `;
                } else {
                    unscheduledEl.style.display = 'none';
                    unscheduledEl.innerHTML = '';
                }
            }

            // Timeline
            if (!timelineEl) return;
            const totalHours = DAY_END_HOUR - DAY_START_HOUR + 1;
            const trackHeight = totalHours * DAY_HOUR_HEIGHT;

            // Build hours column
            let hoursHTML = '';
            for (let h=DAY_START_HOUR; h<=DAY_END_HOUR; h++) {
                const label = String(h).padStart(2,'0') + ':00';
                hoursHTML += `<div class="day-hour"><span>${label}</span></div>`;
            }

            // Build track lines + tasks
            const positioned = computeDayOverlaps(timedTasks);

            // Track lines
            let linesHTML = '';
            for (let h=DAY_START_HOUR; h<=DAY_END_HOUR; h++) {
                const top = (h - DAY_START_HOUR) * DAY_HOUR_HEIGHT;
                linesHTML += `<div class="day-track-hour-line" style="top:${top}px;"></div>`;
                if (h < DAY_END_HOUR) {
                    const halfTop = top + DAY_HOUR_HEIGHT/2;
                    linesHTML += `<div class="day-track-half-line" style="top:${halfTop}px;"></div>`;
                }
            }

            // Now line if today
            let nowLineHTML = '';
            const isToday = localDateStr(new Date()) === dateStr;
            if (isToday) {
                const now = new Date();
                const nowMins = now.getHours()*60 + now.getMinutes();
                if (nowMins >= DAY_START_HOUR*60 && nowMins <= (DAY_END_HOUR+1)*60) {
                    const top = ((nowMins - DAY_START_HOUR*60) / 60) * DAY_HOUR_HEIGHT;
                    const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
                    nowLineHTML = `<div class="day-now-line" style="top:${top}px;"><div class="day-now-time">${timeStr}</div></div>`;
                }
            }

            // Tasks
            let tasksHTML = '';
            positioned.forEach(item => {
                const card = item.card;
                const startOffset = item.start - DAY_START_HOUR*60;
                if (startOffset < -item.duration) return; // completely before
                if (startOffset > totalHours*60) return; // after
                const clampedTop = Math.max(0, (startOffset / 60) * DAY_HOUR_HEIGHT);
                // Clamp height if goes beyond end
                let height = (item.duration / 60) * DAY_HOUR_HEIGHT;
                const maxTop = trackHeight;
                if (clampedTop + height > maxTop) height = maxTop - clampedTop;
                if (height < 26) height = 26; // min visibility

                const col = state.columns.find(col => col.id === card.columnId);
                const isComp = completedCol && card.columnId === completedCol.id;
                const baseColor = card.categoryColor || (col ? col.color : '#0071E3');
                const prioClass = card.priority || 'medium';

                const gap = 4;
                const laneCount = item.laneCount || 1;
                const lane = item.lane || 0;
                const widthPercent = 100 / laneCount;
                const leftPercent = lane * widthPercent;

                const showDesc = height > 54 && card.description;
                const timeLabel = card.scheduledTime || '';
                const durationLabel = formatDuration(item.duration);

                tasksHTML += `
                    <div class="day-task ${isComp ? 'completed' : ''}"
                         style="top:${clampedTop}px; height:${height}px; left:calc(${leftPercent}% + ${gap}px); width:calc(${widthPercent}% - ${gap*2}px); border-left-color:${baseColor};"
                         onclick="showTaskSummary(${card.id})"
                         title="${escapeHtml(card.title)} · ${timeLabel} (${durationLabel})">
                        <div class="day-task-title">${escapeHtml(card.title)}</div>
                        <div class="day-task-meta">
                            <span class="day-task-time">${escapeHtml(timeLabel)}</span>
                            <span class="day-task-duration">${durationLabel}</span>
                            <span class="day-task-prio ${prioClass}"></span>
                            ${card.category ? `<span class="day-task-cat" style="background:${baseColor}" title="${escapeHtml(card.category)}"></span>` : ''}
                        </div>
                        ${showDesc ? `<div class="day-task-desc">${escapeHtml((card.description || '').substring(0,80))}</div>` : ''}
                    </div>
                `;
            });

            const emptyHTML = positioned.length === 0 && unscheduledTasks.length === 0 ? `
                <div class="day-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <div>Aucune tâche pour ce jour</div>
                    <div style="font-size:12px; opacity:0.7;">Cliquez sur la timeline pour ajouter une tâche à cette heure</div>
                </div>
            ` : '';

            timelineEl.innerHTML = `
                <div class="day-hours-col">${hoursHTML}</div>
                <div class="day-track" id="day-track" style="height:${trackHeight}px;" onclick="handleDayTrackClick(event)">
                    ${linesHTML}
                    ${nowLineHTML}
                    ${tasksHTML}
                    ${emptyHTML}
                </div>
            `;
        }

        function handleDayTrackClick(event) {
            // Ignore if clicked on a task
            if (event.target.closest('.day-task')) return;
            const track = document.getElementById('day-track');
            if (!track) return;
            const rect = track.getBoundingClientRect();
            const y = event.clientY - rect.top;
            const minsFromStart = (y / DAY_HOUR_HEIGHT) * 60;
            const totalMins = DAY_START_HOUR*60 + minsFromStart;
            let h = Math.floor(totalMins / 60);
            let m = Math.floor(totalMins % 60);
            // Round to nearest 15 min
            m = Math.round(m / 15) * 15;
            if (m >= 60) { m = 0; h += 1; }
            if (h < 0) h = 0;
            if (h > 23) h = 23;
            const timeStr = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
            const dateStr = localDateStr(currentDayDate);
            showAddCardModalAt(dateStr, timeStr);
        }

        function showAddCardModalAt(dateStr, timeStr) {
            const todayCol = findColumnByRole('today') || state.columns[0];
            if (!todayCol) { showToast('Colonne introuvable'); return; }
            showAddCardModal(todayCol.id);
            // Wait for modal to be in DOM
            setTimeout(() => {
                const dateInput = document.getElementById('card-start-date');
                const timeInput = document.getElementById('card-scheduled-time');
                if (dateInput) dateInput.value = dateStr;
                if (timeInput) timeInput.value = timeStr;
                const titleInput = document.getElementById('card-title');
                if (titleInput) titleInput.focus();
            }, 80);
        }

        // Ensure day view refreshes when data changes
        const _origRenderBoardForDay = renderBoard;
        // Monkey patch saveState triggers? We'll call renderDay in key places via a helper
        function refreshCurrentView() {
            if (currentView === 'day') renderDaySummary();
            else if (currentView === 'calendar') renderCalendar();
            else renderBoard();
        }

        // Override relevant functions to auto-refresh day view
        const _origUpdateStats = updateStats;
        updateStats = function() {
            _origUpdateStats();
            const dayOverlay = document.getElementById('day-container');
            if (dayOverlay && dayOverlay.classList.contains('open')) {
                renderDaySummary();
            }
        };

        const _origCreateCard = createCard;
        // Keep original but also refresh day after (original already does renderBoard/updateStats, which now triggers day refresh)


                // =========== MODAL SYSTEM ============
        function syncRunningTimers() {
            Object.keys(activeTimers).forEach(cardId => {
                const id = Number(cardId);
                const timer = activeTimers[id];
                if (timer && timer.startTime) {
                    const card = state.cards.find(c => c.id === id);
                    if (card) {
                        const now = Date.now();
                        const sessionSeconds = Math.floor((now - timer.startTime) / 1000);
                        if (sessionSeconds > 0) {
                            card.totalTimeSpent = (card.totalTimeSpent || 0) + sessionSeconds;
                            timer.elapsed += sessionSeconds;
                            timer.startTime = now;
                        }
                    }
                }
            });
        }

        function syncWithRoot() {
            try {
                syncRunningTimers();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
            } catch (error) {
                console.error('Save error:', error);
                if (error.name === 'QuotaExceededError') {
                    showToast('Stockage plein');
                }
            }
        }
        function createModal(title, body, buttons) {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

            let footerHTML = '';
            if (buttons.length > 0) {
                footerHTML = '<div class="modal-footer">' +
                    buttons.map(btn => `<button class="btn ${btn.class}" onclick="${btn.onclick}">${btn.text}</button>`).join('') +
                    '</div>';
            }

            overlay.innerHTML = `
                <div class="modal">
                    <div class="modal-header">
                        <div class="modal-title">${escapeHtml(title)}</div>
                        <button class="modal-close" onclick="closeModal()">×</button>
                    </div>
                    <div class="modal-body">${body}</div>
                    ${footerHTML}
                </div>
            `;
            return overlay;
        }

        function closeModal() {
            const modals = document.querySelectorAll('.modal-overlay');
            if (modals.length > 0) {
                const lastModal = modals[modals.length - 1];
                lastModal.classList.add('modal-exiting');
                lastModal.addEventListener('animationend', () => {
                    lastModal.remove();
                    if (document.querySelectorAll('.modal-overlay').length === 0) {
                        closeCardMenu();
                    }
                }, { once: true });
                // Fallback removal after animation duration
                setTimeout(() => {
                    if (lastModal.parentNode) lastModal.remove();
                }, 350);
            }
        }

        function closeAllModals() {
            document.querySelectorAll('.modal-overlay').forEach(m => {
                m.classList.add('modal-exiting');
                m.addEventListener('animationend', () => m.remove(), { once: true });
                setTimeout(() => { if (m.parentNode) m.remove(); }, 350);
            });
            closeCardMenu();
        }

        // =========== UTILITIES ============
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function escapeCsv(text) {
            if (!text) return '';
            return text.replace(/"/g, '""');
        }

        function showToast(message) {
            const toast = document.createElement('div');
            toast.className = 'toast toast-enter';
            toast.textContent = message;
            document.body.appendChild(toast);
            // Trigger enter animation on next frame
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    toast.classList.remove('toast-enter');
                });
            });
            setTimeout(() => {
                toast.classList.add('toast-exit');
                toast.addEventListener('transitionend', () => toast.remove(), { once: true });
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
            }, 3000);
        }

        // =========== COLUMN COLOR SYSTEM ============
        const COLUMN_COLORS = [
            '#6E6E73',
            '#0071E3',
            '#34C759',
            '#FF9500',
            '#FF3B30',
            '#5856D6',
            '#AF52DE',
            '#FF2D55',
            '#FFCC00',
            '#32ADE6',
            '#00C7BE',
            '#FF6482',
        ];

        function changeColumnColor(columnId) {
            const column = state.columns.find(c => c.id === columnId);
            if (!column) return;

            const currentColor = column.color || '#6E6E73';
            const currentIndex = COLUMN_COLORS.indexOf(currentColor);
            const nextIndex = (currentIndex + 1) % COLUMN_COLORS.length;
            column.color = COLUMN_COLORS[nextIndex];
            saveState();
            renderBoard();
            showToast('Couleur de la colonne modifiée');
        }

        function createDefaultColumns() {
            state.columns = [
                { id: 1, title: "Aujourd'hui", color: '#0071E3' },
                { id: 2, title: 'Demain', color: '#FF9500' },
                { id: 3, title: 'Terminé', color: '#34C759' }
            ];
            state.nextColumnId = 4;
            saveState();
        }

        // =========== COLUMN SEARCH & FILTER ============
        let columnFilterState = {};

        function toggleColumnFilter(columnId) {
            const bar = document.getElementById(`filter-bar-${columnId}`);
            const btn = document.getElementById(`filter-btn-${columnId}`);
            if (!bar) return;
            
            const isClosed = bar.style.display === 'none' || bar.classList.contains('filter-bar-closed');
            
            if (!isClosed) {
                bar.classList.add('filter-bar-closed');
                setTimeout(() => { bar.style.display = 'none'; }, 300);
                clearColumnFilter(columnId);
            } else {
                bar.style.display = 'flex';
                setTimeout(() => {
                    bar.classList.remove('filter-bar-closed');
                    const input = document.getElementById(`filter-search-${columnId}`);
                    if (input) input.focus();
                }, 10);
            }
            if (btn) btn.classList.toggle('active', isClosed && hasColumnFilterActive(columnId));
        }

        function hasColumnFilterActive(columnId) {
            const state = columnFilterState[columnId];
            return state && (state.keyword || state.startDate || state.endDate || state.prioFilter || state.statFilter);
        }

        function applyColumnFilter(columnId) {
            const searchInput = document.getElementById(`filter-search-${columnId}`);
            const dateStart = document.getElementById(`filter-date-start-${columnId}`);
            const dateEnd = document.getElementById(`filter-date-end-${columnId}`);
            const priority = document.getElementById(`filter-priority-${columnId}`);
            const status = document.getElementById(`filter-status-${columnId}`);

            if (!searchInput) return;

            const keyword = searchInput.value.toLowerCase().trim();
            const startDate = dateStart ? dateStart.value : '';
            const endDate = dateEnd ? dateEnd.value : '';
            const prioFilter = priority ? priority.value : '';
            const statFilter = status ? status.value : '';

            columnFilterState[columnId] = { keyword, startDate, endDate, prioFilter, statFilter };

            const cards = state.cards.filter(c => c.columnId === columnId);
            const columnEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
            const cardsContainer = columnEl ? columnEl.querySelector('.column-cards') : null;
            if (!cardsContainer) return;

            const cardElements = cardsContainer.querySelectorAll('.card');
            const hasFilters = keyword || startDate || endDate || prioFilter || statFilter;

            if (!hasFilters) {
                cardElements.forEach(el => {
                    el.classList.remove('filter-hidden', 'filter-visible');
                    void el.offsetWidth;
                    el.classList.add('filter-visible');
                });
                const emptyMsg = cardsContainer.querySelector('.empty-column');
                if (emptyMsg) emptyMsg.style.display = 'none';
                const btn = document.getElementById(`filter-btn-${columnId}`);
                if (btn) btn.classList.remove('active');
                return;
            }

            let visibleCount = 0;
            cardElements.forEach(el => {
                const cardId = parseInt(el.dataset.cardId);
                const card = state.cards.find(c => c.id === cardId);
                if (!card) { el.classList.add('filter-hidden'); el.classList.remove('filter-visible'); return; }

                let match = true;

                if (keyword) {
                    const searchable = [
                        card.title,
                        card.description || '',
                        card.category || '',
                        card.startDate || '',
                        card.deadline || '',
                        (card.checklist || []).map(i => i.text).join(' ')
                    ].join(' ').toLowerCase();
                    if (!searchable.includes(keyword)) match = false;
                }

                if (match && startDate) {
                    const d = card.startDate || card.deadline;
                    if (!d || d < startDate) match = false;
                }
                if (match && endDate) {
                    const d = card.startDate || card.deadline;
                    if (!d || d > endDate) match = false;
                }

                if (match && prioFilter) {
                    if (card.priority !== prioFilter) match = false;
                }

                if (match && statFilter) {
                    const cardStatus = getDeadlineStatus(card.deadline, card.scheduledTime);
                    if (cardStatus !== statFilter) match = false;
                }

                if (match) {
                    el.classList.remove('filter-hidden', 'filter-visible');
                    void el.offsetWidth;
                    el.classList.add('filter-visible');
                    visibleCount++;
                } else {
                    el.classList.remove('filter-visible');
                    el.classList.add('filter-hidden');
                }
            });

            let emptyMsg = cardsContainer.querySelector('.empty-column');
            if (visibleCount === 0 && cards.length > 0) {
                if (!emptyMsg) {
                    const msg = document.createElement('div');
                    msg.className = 'empty-column';
                    msg.textContent = 'Aucun résultat';
                    cardsContainer.appendChild(msg);
                } else {
                    emptyMsg.style.display = '';
                    emptyMsg.textContent = 'Aucun résultat';
                }
            } else if (emptyMsg) {
                emptyMsg.style.display = 'none';
            }

            const btn = document.getElementById(`filter-btn-${columnId}`);
            if (btn) btn.classList.toggle('active', hasFilters);
        }

    function clearColumnFilter(columnId) {
        const searchInput = document.getElementById(`filter-search-${columnId}`);
        const dateStart = document.getElementById(`filter-date-start-${columnId}`);
        const dateEnd = document.getElementById(`filter-date-end-${columnId}`);
        const priority = document.getElementById(`filter-priority-${columnId}`);
        const status = document.getElementById(`filter-status-${columnId}`);

        if (searchInput) searchInput.value = '';
        if (dateStart) dateStart.value = '';
        if (dateEnd) dateEnd.value = '';
        if (priority) priority.value = '';
        if (status) status.value = '';

        delete columnFilterState[columnId];

        const columnEl = document.querySelector(`.column[data-column-id="${columnId}"]`);
        const cardsContainer = columnEl ? columnEl.querySelector('.column-cards') : null;
        if (cardsContainer) {
            cardsContainer.querySelectorAll('.card').forEach(el => {
                el.classList.remove('filter-hidden', 'filter-visible');
                void el.offsetWidth;
                el.classList.add('filter-visible');
            });
            const emptyMsg = cardsContainer.querySelector('.empty-column');
            if (emptyMsg) emptyMsg.style.display = 'none';
        }

        const btn = document.getElementById(`filter-btn-${columnId}`);
        if (btn) btn.classList.remove('active');
    }

        // =========== STAT QUICK FILTER ============
        let activeStatFilter = null;

        function toggleStatFilter(filterType) {
            if (activeStatFilter === filterType) {
                activeStatFilter = null;
            } else {
                activeStatFilter = filterType;
            }
            applyStatFilter();
            updateStatFilterUI();
        }

        function applyStatFilter() {
            // Pose (ou retire) la classe sur le board pour figer la largeur des
            // colonnes visibles tant qu'un filtre de stat est actif — sinon les
            // colonnes restantes s'étiraient pour combler la place des masquées.
            const statBoard = document.getElementById('board');
            if (statBoard) statBoard.classList.toggle('stat-filter-active', !!activeStatFilter);

            if (!activeStatFilter) {
                document.querySelectorAll('.column').forEach(col => {
                    col.classList.remove('filter-column-hidden');
                    col.classList.add('filter-column-visible');
                    col.querySelectorAll('.card').forEach(card => {
                        card.classList.remove('filter-hidden');
                        card.classList.add('filter-visible');
                    });
                    const emptyMsg = col.querySelector('.empty-column');
                    if (emptyMsg) emptyMsg.style.display = '';
                });
                return;
            }

            const completedCol = findColumnByRole('completed');
            const progressCol = findColumnByRole('tomorrow');
            const todoCol = findColumnByRole('today');

            document.querySelectorAll('.column').forEach(col => {
                const colId = parseInt(col.dataset.columnId);
                const cardsInCol = col.querySelectorAll('.card');
                let visibleCount = 0;

                cardsInCol.forEach(cardEl => {
                    const cardId = parseInt(cardEl.dataset.cardId);
                    const card = state.cards.find(c => c.id === cardId);
                    if (!card) {
                        cardEl.classList.add('filter-hidden');
                        cardEl.classList.remove('filter-visible');
                        return;
                    }

                    let show = false;
                    if (activeStatFilter === 'completed') {
                        show = completedCol && card.columnId === completedCol.id;
                    } else if (activeStatFilter === 'progress') {
                        show = progressCol && card.columnId === progressCol.id;
                    } else if (activeStatFilter === 'todo') {
                        show = todoCol && card.columnId === todoCol.id;
                    } else if (activeStatFilter === 'overdue') {
                        const deadlineCol = state.columns.find(c => c.id === card.columnId);
                        if (!isCompletedColumn(deadlineCol)) {
                            show = getDeadlineStatus(card.deadline, card.scheduledTime) === 'overdue';
                        }
                    }

                    if (show) {
                        /* Remove then re-add to force animation restart */
                        cardEl.classList.remove('filter-hidden', 'filter-visible');
                        void cardEl.offsetWidth; /* reflow trigger */
                        cardEl.classList.add('filter-visible');
                        visibleCount++;
                    } else {
                        cardEl.classList.remove('filter-visible');
                        cardEl.classList.add('filter-hidden');
                    }
                });

                const shouldShow = (
                    (activeStatFilter === 'overdue' && visibleCount > 0) ||
                    (activeStatFilter === 'completed' && completedCol && colId === completedCol.id) ||
                    (activeStatFilter === 'progress' && progressCol && colId === progressCol.id) ||
                    (activeStatFilter === 'todo' && todoCol && colId === todoCol.id)
                );

                if (shouldShow) {
                    col.classList.remove('filter-column-hidden');
                    void col.offsetWidth;
                    col.classList.add('filter-column-visible');
                } else {
                    col.classList.remove('filter-column-visible');
                    col.classList.add('filter-column-hidden');
                }

                const emptyMsg = col.querySelector('.empty-column');
                if (emptyMsg) {
                    const origCardCount = state.cards.filter(c => c.columnId === colId).length;
                    if (visibleCount === 0 && origCardCount > 0) {
                        emptyMsg.style.display = '';
                        emptyMsg.textContent = 'Aucun résultat';
                    } else {
                        emptyMsg.style.display = 'none';
                    }
                }
            });
        }

        function updateStatFilterUI() {
            document.querySelectorAll('.stat-item').forEach(el => el.classList.remove('stat-active'));
            if (activeStatFilter) {
                const el = document.querySelector(`[data-stat-type="${activeStatFilter}"]`);
                if (el) el.classList.add('stat-active');
            }
        }

        // =========== EVENT LISTENERS ============
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('card-menu');
            if (menu && !menu.contains(e.target) && !e.target.closest('.card-menu-btn')) {
                closeCardMenu();
            }
        });

        // =========== POP-UP QR CODE (copyright) ============
        function openQRPopup() {
            const popup = document.getElementById('qr-popup');
            if (!popup) return;
            popup.classList.add('open');
        }
        function closeQRPopup() {
            const popup = document.getElementById('qr-popup');
            if (!popup) return;
            popup.classList.remove('open');
        }
        // Fermeture au clic sur l'arrière-plan
        document.addEventListener('DOMContentLoaded', () => {
            const popup = document.getElementById('qr-popup');
            if (popup) {
                popup.addEventListener('click', (e) => {
                    if (e.target === popup) closeQRPopup();
                });
            }
            const dayOverlay = document.getElementById('day-container');
            if (dayOverlay) {
                dayOverlay.addEventListener('click', (e) => {
                    if (e.target === dayOverlay) closeDaySummary();
                });
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeQRPopup(); closeModal(); closeDaySummary(); }
        });

        window.addEventListener('beforeunload', () => {
            syncRunningTimers();
            saveState();
        });

        (function enableBoardHorizontalScroll() {
            function onWheel(e) {
                const boardContainer = e.currentTarget;
                if (!boardContainer) return;

                const cardsEl = e.target.closest('.column-cards');
                if (cardsEl && !e.shiftKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
                    const canScrollUp = cardsEl.scrollTop > 0;
                    const canScrollDown = cardsEl.scrollTop + cardsEl.clientHeight < cardsEl.scrollHeight - 1;
                    if ((e.deltaY < 0 && canScrollUp) || (e.deltaY > 0 && canScrollDown)) {
                        return;
                    }
                }

                const maxScroll = boardContainer.scrollWidth - boardContainer.clientWidth;
                if (maxScroll <= 0) return;

                let dx = 0;
                if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                    dx = e.deltaX;
                } else if (e.shiftKey || !cardsEl) {
                    dx = e.deltaY;
                } else {
                    return;
                }

                if (!dx) return;
                const prev = boardContainer.scrollLeft;
                boardContainer.scrollLeft = Math.max(0, Math.min(maxScroll, prev + dx));
                if (boardContainer.scrollLeft !== prev) {
                    e.preventDefault();
                }
            }

            function bind() {
                const el = document.querySelector('.board-container');
                if (!el || el.dataset.hScrollBound === '1') return;
                el.addEventListener('wheel', onWheel, { passive: false });
                el.dataset.hScrollBound = '1';
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', bind);
            } else {
                bind();
            }
            window.addEventListener('load', bind);
        })();

        // =========== STAT ANIMATION ============
        function animateStatNumber(elementId, newValue) {
            const el = document.getElementById(elementId);
            if (!el) return;
            const currentValue = parseInt(el.textContent) || 0;
            if (currentValue === newValue) return;
            
            // Pop animation
            el.textContent = newValue;
            el.classList.remove('count-pop');
            void el.offsetWidth; // force reflow
            el.classList.add('count-pop');
            el.addEventListener('animationend', () => el.classList.remove('count-pop'), { once: true });
        }

        function animateStatsEntrance() {
            document.querySelectorAll('.stat-item').forEach((el, i) => {
                el.classList.add('stat-enter');
                el.style.setProperty('--stat-stagger-delay', `${i * 80 + 100}ms`);
            });
        }

        // =========== START APP ============
        try {
            init();
        } catch (error) {
            console.error('Init failed:', error);
            var banner = document.getElementById('error-banner');
            if (banner) {
                document.getElementById('error-banner-text').textContent = 'Erreur: ' + error.message;
                banner.classList.add('visible');
            }
            createDefaultColumns();
            try { renderBoard(); updateStats(); } catch (_) {}
        }
