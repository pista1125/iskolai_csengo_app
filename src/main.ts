import './style.css'
import { auth as firebaseAuth, db as firebaseDb, isFirebaseConfigured, initFirebase, HARDCODED_CONFIG } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { 
  ref, 
  onValue, 
  set, 
  update, 
  off 
} from 'firebase/database';
import type { DatabaseReference } from 'firebase/database';

interface BellSchedule {
  id: string;
  time: string;
  type: 'in' | 'out';
}

class SchoolBellApp {
  private schedules: BellSchedule[] = [];
  private inBellAudio: HTMLAudioElement | null = null;
  private outBellAudio: HTMLAudioElement | null = null;
  private fireAlarmAudio: HTMLAudioElement | null = null;
  private isFireAlarmPlaying = false;
  private audioUnlocked = false;
  
  // Local Mic variables
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  // Remote Broadcast variables
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;
  private recordingTimer: any = null;
  private recordingStartTime = 0;

  // Firebase state
  private currentUser: User | null = null;
  private mode: 'receiver' | 'controller' = 'receiver';
  private schedulesRef: DatabaseReference | null = null;
  private settingsRef: DatabaseReference | null = null;
  private liveRef: DatabaseReference | null = null;

  // Heartbeats & status checks
  private lastTriggerRingTimestamp = 0;
  private lastPlayedBroadcastTimestamp = 0;
  private receiverLastSeen = 0;
  private heartbeatInterval: any = null;
  private receiverStatusInterval: any = null;

  private static readonly BELL_PRESETS = [
    { name: 'Levitating - Dua Lipa', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/59/dc/4d/59dc4dda-93ff-8f1c-c536-f005f6ea6af5/mzaf_3066686759813252385.plus.aac.p.m4a' },
    { name: 'As It Was - Harry Styles', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/67/10/16/67101606-3869-ca44-6c03-e13d6322cb51/mzaf_1135399237022217274.plus.aac.p.m4a' },
    { name: 'Shake It Off - Taylor Swift', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/11/d5/6d/11d56d4a-ce23-e793-8681-70dc4d35d931/mzaf_5886436202259848624.plus.aac.p.m4a' },
    { name: 'good 4 u - Olivia Rodrigo', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/9f/bd/f1/9fbdf1ce-12d9-7440-1c1c-3fed40567619/mzaf_7303839465958373073.plus.aac.p.m4a' },
    { name: 'Blinding Lights - The Weeknd', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/17/b4/8f/17b48f9a-0b93-6bb8-fe1d-3a16623c2cfb/mzaf_9560252727299052414.plus.aac.p.m4a' },
    { name: 'Thunder - Imagine Dragons', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/78/7d/8b/787d8b89-7b57-d3bc-1f9d-6378fad1b4f5/mzaf_5131352572683029126.plus.aac.p.m4a' },
    { name: 'Heat Waves - Glass Animals', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/a3/4c/b9/a34cb911-40fc-5f0c-e862-14bd171a77aa/mzaf_384792072030970151.plus.aac.p.m4a' },
    { name: 'golden hour - JVKE', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/30/02/8c/30028c8a-a125-5466-bcc6-27a83b1c0135/mzaf_16911571635366913039.plus.aac.p.m4a' },
    { name: 'bad guy - Billie Eilish', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/c3/87/1f/c3871f7e-3260-d615-1c66-5fdca2c3a48f/mzaf_10721331211699880949.plus.aac.p.m4a' },
    { name: 'I Ain\'t Worried - OneRepublic', url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/1e/a1/3d/1ea13da1-8ac6-e603-ec6f-3f6d5b89f8f3/mzaf_8445589109258687921.plus.aac.p.m4a' }
  ];

  constructor() {
    this.initPresetSelectors();
    this.loadSchedulesLocally();
    this.initClock();
    this.setupEventListeners();
    this.initAudio();
    this.initDeviceSelection();
    this.setupFirebaseUI();
  }

  private initPresetSelectors() {
    ['in', 'out'].forEach(type => {
      const select = document.getElementById(`${type}-preset-select`) as HTMLSelectElement;
      if (select) {
        // Clear except custom
        select.innerHTML = '<option value="custom">-- Egyéni feltöltés --</option>';
        SchoolBellApp.BELL_PRESETS.forEach((preset, index) => {
          const opt = document.createElement('option');
          opt.value = index.toString();
          opt.textContent = preset.name;
          select.appendChild(opt);
        });
      }
    });
  }

  private handlePresetSelection(event: Event, type: 'in' | 'out') {
    const val = (event.target as HTMLSelectElement).value;
    if (val === 'custom') return;

    const preset = SchoolBellApp.BELL_PRESETS[parseInt(val)];
    if (!preset) return;

    if (this.currentUser && firebaseDb) {
      update(ref(firebaseDb, `users/${this.currentUser.uid}/settings`), {
        [type === 'in' ? 'audioIn' : 'audioOut']: {
          type: 'preset',
          value: val,
          name: preset.name
        }
      });
    } else {
      if (type === 'in') {
        this.inBellAudio = new Audio(preset.url);
      } else {
        this.outBellAudio = new Audio(preset.url);
      }

      const nameEl = document.getElementById(`${type}-bell-name`);
      if (nameEl) nameEl.textContent = preset.name;

      localStorage.setItem(`audio-${type}-type`, 'preset');
      localStorage.setItem(`audio-${type}-value`, val);
      localStorage.removeItem(`audio-${type}`); 
    }
  }

  private initAudio() {
    if (!this.audioContext) this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.fireAlarmAudio = new Audio('https://www.orangefreesounds.com/wp-content/uploads/2014/12/Fire-alarm-sound.mp3');
    this.fireAlarmAudio.loop = true;

    const unlock = () => {
      if (this.audioUnlocked) return;
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      
      const silentPlay = (audio: HTMLAudioElement | null) => {
        if (audio) {
          audio.play().then(() => {
            audio.pause();
            audio.currentTime = 0;
          }).catch(e => console.log('Autoplay unlock audio failed:', e));
        }
      };
      
      silentPlay(this.fireAlarmAudio);
      silentPlay(this.inBellAudio);
      silentPlay(this.outBellAudio);
      
      this.audioUnlocked = true;
      
      const banner = document.getElementById('autoplay-warning-banner');
      if (banner) banner.classList.add('hidden');
      
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
    
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
  }

  private async initDeviceSelection() {
    await this.refreshDevices();
    navigator.mediaDevices.ondevicechange = () => this.refreshDevices();

    document.getElementById('audio-output-select')?.addEventListener('change', (e) => {
        const deviceId = (e.target as HTMLSelectElement).value;
        this.updateAudioOutput(deviceId);
    });

    document.getElementById('refresh-devices-btn')?.addEventListener('click', () => this.refreshDevices());
  }

  private async refreshDevices() {
    try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        const inputs = devices.filter(d => d.kind === 'audioinput');

        const outSelect = document.getElementById('audio-output-select') as HTMLSelectElement;
        const inSelect = document.getElementById('audio-input-select') as HTMLSelectElement;

        if (outSelect) {
            outSelect.innerHTML = '<option value="default">Kimenet: Alapértelmezett</option>';
            outputs.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Eszköz (${d.deviceId.slice(0, 5)})`;
                outSelect.appendChild(opt);
            });
        }

        if (inSelect) {
            inSelect.innerHTML = '<option value="default">Bemenet: Alapértelmezett</option>';
            inputs.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Mikrofon (${d.deviceId.slice(0, 5)})`;
                inSelect.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('Error listing devices:', err);
    }
  }

  private async updateAudioOutput(deviceId: string) {
    if (this.audioContext && (this.audioContext as any).setSinkId) {
        try {
            await (this.audioContext as any).setSinkId(deviceId);
        } catch (err) {
            console.error('Context SinkId error:', err);
        }
    }

    const audios = [this.fireAlarmAudio, this.inBellAudio, this.outBellAudio];
    for (const audio of audios) {
        if (audio && (audio as any).setSinkId) {
            try {
                await (audio as any).setSinkId(deviceId);
            } catch (err) {
                console.error('Element SinkId error:', err);
            }
        }
    }
  }

  private initClock() {
    const clockEl = document.getElementById('current-clock')!;
    const dateEl = document.getElementById('current-date')!;
    const updateTime = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('hu-HU', { hour12: false });
      clockEl.textContent = timeStr;
      
      const dateStr = now.toLocaleDateString('hu-HU', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        weekday: 'long'
      }).toUpperCase();
      if (dateEl) dateEl.textContent = dateStr;

      this.checkBells(now);
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  private setupEventListeners() {
    document.getElementById('add-in-bell')?.addEventListener('click', () => this.addSchedule('in'));
    document.getElementById('add-out-bell')?.addEventListener('click', () => this.addSchedule('out'));
    
    document.getElementById('in-bell-file')?.addEventListener('change', (e) => this.handleFileUpload(e, 'in'));
    document.getElementById('out-bell-file')?.addEventListener('change', (e) => this.handleFileUpload(e, 'out'));

    document.getElementById('fire-alarm-btn')?.addEventListener('click', () => this.toggleFireAlarm());
    document.getElementById('mic-toggle-btn')?.addEventListener('click', () => this.toggleMic());
    document.getElementById('manual-ring-in-btn')?.addEventListener('click', () => this.triggerManualRing('in'));
    document.getElementById('manual-ring-out-btn')?.addEventListener('click', () => this.triggerManualRing('out'));

    document.getElementById('weekend-ringing')?.addEventListener('change', () => {
      const isChecked = (document.getElementById('weekend-ringing') as HTMLInputElement).checked;
      if (this.currentUser && firebaseDb) {
        update(ref(firebaseDb, `users/${this.currentUser.uid}/settings`), { weekendRinging: isChecked });
      } else {
        localStorage.setItem('weekend-ringing', isChecked ? 'true' : 'false');
      }
    });

    document.getElementById('bell-duration')?.addEventListener('change', () => {
      const durationVal = parseInt((document.getElementById('bell-duration') as HTMLInputElement).value);
      if (this.currentUser && firebaseDb) {
        update(ref(firebaseDb, `users/${this.currentUser.uid}/settings`), { bellDuration: durationVal });
      } else {
        localStorage.setItem('bell-duration', durationVal.toString());
      }
    });

    document.getElementById('in-preset-select')?.addEventListener('change', (e) => this.handlePresetSelection(e, 'in'));
    document.getElementById('out-preset-select')?.addEventListener('change', (e) => this.handlePresetSelection(e, 'out'));

    // Firebase Auth listeners
    document.getElementById('save-config-btn')?.addEventListener('click', () => {
      const input = (document.getElementById('firebase-config-input') as HTMLTextAreaElement).value;
      this.handleFirebaseConfigSave(input);
    });

    document.getElementById('edit-config-btn')?.addEventListener('click', () => {
      if (confirm('Biztosan törlöd a Firebase beállításokat és újra konfigurálod?')) {
        localStorage.removeItem('firebase-bell-config');
        window.location.reload();
      }
    });

    document.getElementById('login-btn')?.addEventListener('click', () => this.handleLogin());
    document.getElementById('register-btn')?.addEventListener('click', () => this.handleRegister());
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      if (firebaseAuth) signOut(firebaseAuth);
    });

    // Mode Selector listeners
    document.getElementById('mode-btn-receiver')?.addEventListener('click', () => this.setDeviceMode('receiver'));
    document.getElementById('mode-btn-controller')?.addEventListener('click', () => this.setDeviceMode('controller'));
  }

  // --- FIREBASE AUTHENTICATION AND SETUP LOGIC ---
  private setupFirebaseUI() {
    const setupScreen = document.getElementById('firebase-setup-screen')!;
    const loginScreen = document.getElementById('login-screen')!;
    const appContainer = document.getElementById('app')!;

    if (!isFirebaseConfigured()) {
      setupScreen.classList.remove('hidden');
      loginScreen.classList.add('hidden');
      appContainer.classList.add('hidden');
      
      const configInput = document.getElementById('firebase-config-input') as HTMLTextAreaElement;
      if (configInput && !configInput.value) {
        configInput.value = `const firebaseConfig = {\n  apiKey: "${HARDCODED_CONFIG.apiKey}",\n  authDomain: "${HARDCODED_CONFIG.authDomain}",\n  databaseURL: "${HARDCODED_CONFIG.databaseURL}",\n  projectId: "${HARDCODED_CONFIG.projectId}",\n  storageBucket: "${HARDCODED_CONFIG.storageBucket}",\n  messagingSenderId: "${HARDCODED_CONFIG.messagingSenderId}",\n  appId: "${HARDCODED_CONFIG.appId}"\n};`;
      }
      return;
    }

    setupScreen.classList.add('hidden');
    
    if (firebaseAuth) {
      onAuthStateChanged(firebaseAuth, (user) => {
        if (user) {
          this.currentUser = user;
          loginScreen.classList.add('hidden');
          appContainer.classList.remove('hidden');
          
          const userEmailEl = document.getElementById('user-email-text');
          if (userEmailEl) userEmailEl.textContent = user.email || 'Bejelentkezve';
          
          this.initFirebaseSync();
        } else {
          this.currentUser = null;
          this.cleanupFirebaseSync();
          loginScreen.classList.remove('hidden');
          appContainer.classList.add('hidden');
        }
        (window as any).lucide?.createIcons();
      });
    }
  }

  private handleFirebaseConfigSave(input: string) {
    try {
      const cleanInput = input.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
      
      const configObj: any = {};
      const fields = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
      
      fields.forEach(field => {
        const regex = new RegExp(`${field}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`);
        const match = cleanInput.match(regex);
        if (match && match[1]) {
          configObj[field] = match[1].trim();
        }
      });
      
      if (!configObj.apiKey || !configObj.projectId) {
        throw new Error('Nem sikerült kinyerni a kulcsokat. Ellenőrizd a beillesztett kódot!');
      }
      
      const ok = initFirebase(configObj);
      if (ok) {
        alert('Firebase beállítások sikeresen mentve! Az oldal újraindul.');
        window.location.reload();
      } else {
        throw new Error('Sikertelen inicializálás.');
      }
    } catch (e: any) {
      alert('Hiba a konfiguráció mentésekor: ' + e.message);
    }
  }

  private async handleLogin() {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('auth-password') as HTMLInputElement).value;
    
    if (!email || !password) {
      alert('Kérlek töltsd ki az összes mezőt!');
      return;
    }
    
    try {
      const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
      loginBtn.disabled = true;
      loginBtn.textContent = 'BELÉPÉS...';
      
      if (firebaseAuth) {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
      }
    } catch (e: any) {
      alert('Sikertelen bejelentkezés: ' + this.getHungarianAuthError(e.code));
    } finally {
      const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'BEJELENTKEZÉS';
      }
    }
  }

  private async handleRegister() {
    const email = (document.getElementById('auth-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('auth-password') as HTMLInputElement).value;
    
    if (!email || !password) {
      alert('Kérlek töltsd ki az összes mezőt!');
      return;
    }
    
    if (password.length < 6) {
      alert('A jelszónak legalább 6 karakterből kell állnia!');
      return;
    }
    
    try {
      const registerBtn = document.getElementById('register-btn') as HTMLButtonElement;
      registerBtn.disabled = true;
      registerBtn.textContent = 'REGISZTRÁCIÓ...';
      
      if (firebaseAuth) {
        await createUserWithEmailAndPassword(firebaseAuth, email, password);
        alert('Sikeres regisztráció! Automatikusan beléptettünk.');
      }
    } catch (e: any) {
      alert('Sikertelen regisztráció: ' + this.getHungarianAuthError(e.code));
    } finally {
      const registerBtn = document.getElementById('register-btn') as HTMLButtonElement;
      if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.textContent = 'ÚJ FIÓK REGISZTRÁCIÓJA';
      }
    }
  }

  private getHungarianAuthError(code: string): string {
    switch (code) {
      case 'auth/invalid-email': return 'Érvénytelen email cím formátum.';
      case 'auth/user-disabled': return 'Ez a felhasználói fiók le van tiltva.';
      case 'auth/user-not-found': return 'Nem található felhasználó ezzel az email címmel.';
      case 'auth/wrong-password': return 'Hibás jelszó.';
      case 'auth/email-already-in-use': return 'Ez az email cím már használatban van.';
      case 'auth/weak-password': return 'A jelszó túl gyenge (legalább 6 karakter szükséges).';
      case 'auth/invalid-credential': return 'Hibás hitelesítő adatok (jelszó vagy email).';
      default: return code || 'Ismeretlen hiba történt.';
    }
  }

  // --- FIREBASE SYNC LOGIC ---
  private initFirebaseSync() {
    if (!firebaseDb || !this.currentUser) return;
    
    const uid = this.currentUser.uid;
    this.schedulesRef = ref(firebaseDb, `users/${uid}/schedules`);
    this.settingsRef = ref(firebaseDb, `users/${uid}/settings`);
    this.liveRef = ref(firebaseDb, `users/${uid}/live`);
    
    // Load local storage mode preference
    const savedMode = localStorage.getItem('device-mode') as 'receiver' | 'controller';
    this.setDeviceMode(savedMode || 'receiver');
    
    // Listen for schedules
    onValue(this.schedulesRef, (snapshot) => {
      const val = snapshot.val();
      if (val !== null) {
        this.schedules = Array.isArray(val) ? val : Object.values(val);
        this.schedules.sort((a, b) => a.time.localeCompare(b.time));
        this.renderSchedules();
      } else {
        // First sync migration
        const savedLocal = localStorage.getItem('bell-schedules');
        if (savedLocal) {
          try {
            const localSchedules = JSON.parse(savedLocal);
            if (localSchedules.length > 0 && this.schedulesRef) {
              set(this.schedulesRef, localSchedules);
            }
          } catch (e) {}
        }
      }
    });
    
    // Listen for settings
    onValue(this.settingsRef, (snapshot) => {
      const settings = snapshot.val();
      if (settings) {
        if (settings.weekendRinging !== undefined) {
          const wrToggle = document.getElementById('weekend-ringing') as HTMLInputElement;
          if (wrToggle) wrToggle.checked = settings.weekendRinging;
        }
        
        if (settings.bellDuration !== undefined) {
          const bdInput = document.getElementById('bell-duration') as HTMLInputElement;
          if (bdInput) bdInput.value = settings.bellDuration.toString();
        }
        
        ['in', 'out'].forEach(type => {
          const audioConf = type === 'in' ? settings.audioIn : settings.audioOut;
          if (audioConf) {
            const nameEl = document.getElementById(`${type}-bell-name`);
            const select = document.getElementById(`${type}-preset-select`) as HTMLSelectElement;
            
            if (audioConf.type === 'preset') {
              const presetVal = audioConf.value;
              const preset = SchoolBellApp.BELL_PRESETS[parseInt(presetVal)];
              if (preset) {
                if (type === 'in') this.inBellAudio = new Audio(preset.url);
                else this.outBellAudio = new Audio(preset.url);
                if (nameEl) nameEl.textContent = preset.name;
                if (select) select.value = presetVal;
              }
            } else if (audioConf.type === 'custom') {
              if (audioConf.data) {
                if (type === 'in') this.inBellAudio = new Audio(audioConf.data);
                else this.outBellAudio = new Audio(audioConf.data);
                if (nameEl) nameEl.textContent = audioConf.name || 'Egyéni hang';
                if (select) select.value = 'custom';
              }
            }
          }
        });
      }
    });
    
    // Listen for live events
    this.setupReceiverListeners();
  }

  private cleanupFirebaseSync() {
    if (this.schedulesRef) off(this.schedulesRef);
    if (this.settingsRef) off(this.settingsRef);
    if (this.liveRef) off(this.liveRef);
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.receiverStatusInterval) {
      clearInterval(this.receiverStatusInterval);
      this.receiverStatusInterval = null;
    }
  }

  private setupReceiverListeners() {
    if (!firebaseDb || !this.currentUser) return;
    
    const uid = this.currentUser.uid;
    
    // Listen to manual ring triggers
    onValue(ref(firebaseDb, `users/${uid}/live/triggerRing`), (snapshot) => {
      if (this.mode !== 'receiver') return;
      const data = snapshot.val();
      if (data && data.type && data.timestamp) {
        if (data.timestamp > this.lastTriggerRingTimestamp && (Date.now() - data.timestamp) < 5000) {
          this.lastTriggerRingTimestamp = data.timestamp;
          this.playBell(data.type);
        }
      }
    });
    
    // Listen to fire alarm
    onValue(ref(firebaseDb, `users/${uid}/live/fireAlarm`), (snapshot) => {
      const isAlarm = snapshot.val();
      if (isAlarm !== null) {
        if (isAlarm !== this.isFireAlarmPlaying) {
          this.toggleFireAlarmLocally(isAlarm);
        }
      }
    });
    
    // Listen to live voice broadcast
    onValue(ref(firebaseDb, `users/${uid}/live/broadcast`), (snapshot) => {
      if (this.mode !== 'receiver') return;
      const data = snapshot.val();
      if (data && data.audio && data.timestamp) {
        if (data.timestamp > this.lastPlayedBroadcastTimestamp && (Date.now() - data.timestamp) < 10000) {
          this.lastPlayedBroadcastTimestamp = data.timestamp;
          this.playBroadcastAudio(data.audio);
        }
      }
    });
    
    // Listen to receiver heartbeat (for controller to display status)
    onValue(ref(firebaseDb, `users/${uid}/live/receiver/lastSeen`), (snapshot) => {
      if (this.mode !== 'controller') return;
      const val = snapshot.val();
      this.receiverLastSeen = val || 0;
      this.updateReceiverStatusBadge();
    });
  }

  private setDeviceMode(newMode: 'receiver' | 'controller') {
    this.mode = newMode;
    localStorage.setItem('device-mode', newMode);
    
    const rBtn = document.getElementById('mode-btn-receiver');
    const cBtn = document.getElementById('mode-btn-controller');
    
    if (newMode === 'receiver') {
      rBtn?.classList.add('active');
      cBtn?.classList.remove('active');
      
      if (this.receiverStatusInterval) {
        clearInterval(this.receiverStatusInterval);
        this.receiverStatusInterval = null;
      }
      
      this.toggleLocalInputs(true);
      
      // Stop recording if switching modes
      if (this.isRecording) this.stopRemoteRecording();

      const micBtn = document.getElementById('mic-toggle-btn');
      if (micBtn) {
        micBtn.innerHTML = '<i data-lucide="mic"></i> MIKROFON ADÁS';
        micBtn.className = 'btn btn-neon-blue';
        (window as any).lucide.createIcons();
      }
      
      // Start receiver heartbeat
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.sendHeartbeat();
      this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 5000);
      
      this.updateReceiverStatusBadge();
    } else {
      cBtn?.classList.add('active');
      rBtn?.classList.remove('active');
      
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      
      this.toggleLocalInputs(false);
      
      const micBtn = document.getElementById('mic-toggle-btn');
      if (micBtn) {
        micBtn.innerHTML = '<i data-lucide="mic"></i> TÁVOLI HANGOSBEMONDÓ';
        micBtn.className = 'btn btn-neon-blue';
        (window as any).lucide.createIcons();
      }
      
      // Start receiver offline status checker loop
      if (this.receiverStatusInterval) clearInterval(this.receiverStatusInterval);
      this.updateReceiverStatusBadge();
      this.receiverStatusInterval = setInterval(() => this.updateReceiverStatusBadge(), 1000);
    }
  }

  private sendHeartbeat() {
    if (!firebaseDb || !this.currentUser) return;
    const uid = this.currentUser.uid;
    set(ref(firebaseDb, `users/${uid}/live/receiver/lastSeen`), Date.now());
  }

  private updateReceiverStatusBadge() {
    const badge = document.getElementById('receiver-status-badge');
    if (!badge) return;
    
    if (this.mode === 'receiver') {
      badge.textContent = 'LEJÁTSZÓ: AKTÍV';
      badge.className = 'badge badge-online';
      badge.style.borderColor = 'var(--success-neon)';
      badge.style.color = 'var(--success-neon)';
      badge.style.background = 'rgba(16, 185, 129, 0.1)';
      return;
    }
    
    const isOnline = (Date.now() - this.receiverLastSeen) < 15000;
    if (isOnline) {
      badge.textContent = 'LEJÁTSZÓ: ONLINE';
      badge.className = 'badge badge-online';
      badge.style.borderColor = 'var(--success-neon)';
      badge.style.color = 'var(--success-neon)';
      badge.style.background = 'rgba(16, 185, 129, 0.1)';
    } else {
      badge.textContent = 'LEJÁTSZÓ: OFFLINE';
      badge.className = 'badge badge-offline';
      badge.style.borderColor = 'var(--danger-neon)';
      badge.style.color = 'var(--danger-neon)';
      badge.style.background = 'rgba(244, 63, 94, 0.1)';
    }
  }

  private toggleLocalInputs(enable: boolean) {
    const outSelect = document.getElementById('audio-output-select') as HTMLSelectElement;
    if (outSelect) outSelect.disabled = !enable;
  }

  // --- AUDIO BROADCASTING PLAYBACK ---
  private playBroadcastAudio(base64Data: string) {
    try {
      const audio = new Audio(base64Data);
      
      const outSelect = document.getElementById('audio-output-select') as HTMLSelectElement;
      const deviceId = outSelect ? outSelect.value : 'default';
      if (deviceId !== 'default' && (audio as any).setSinkId) {
        (audio as any).setSinkId(deviceId).catch((err: any) => console.error(err));
      }
      
      const isBellPlaying = this.inBellAudio && !this.inBellAudio.paused;
      const isAlarmPlaying = this.fireAlarmAudio && !this.fireAlarmAudio.paused;
      
      if (isBellPlaying) this.inBellAudio!.volume = 0.2;
      if (isAlarmPlaying) this.fireAlarmAudio!.volume = 0.2;
      
      audio.play().catch(e => {
        console.error('Error playing broadcast audio:', e);
        this.showAutoplayWarning();
      });
      audio.onended = () => {
        if (this.inBellAudio) this.inBellAudio.volume = 1.0;
        if (this.fireAlarmAudio) this.fireAlarmAudio.volume = 1.0;
      };
    } catch (err) {
      console.error('Error playing broadcast audio:', err);
    }
  }

  private showAutoplayWarning() {
    let banner = document.getElementById('autoplay-warning-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'autoplay-warning-banner';
      banner.className = 'autoplay-warning';
      banner.innerHTML = '<i data-lucide="volume-x"></i> KATTINTS BÁRHOVA A KÉPERNYŐRE A HANGOK ENGEDÉLYEZÉSÉHEZ!';
      document.body.prepend(banner);
      (window as any).lucide?.createIcons();
    }
    banner.classList.remove('hidden');
  }

  // --- REMOTE MICROPHONE RECORDING (PTT) ---
  private async startRemoteRecording() {
    try {
      const inSelect = document.getElementById('audio-input-select') as HTMLSelectElement;
      const deviceId = inSelect ? inSelect.value : 'default';
      const constraints = { 
          audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } 
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.micStream = stream;
      
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      }
      
      this.mediaRecorder = new MediaRecorder(stream, options);
      this.recordedChunks = [];
      
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      
      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.recordedChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          
          if (this.currentUser && firebaseDb) {
            set(ref(firebaseDb, `users/${this.currentUser.uid}/live/broadcast`), {
              audio: base64Audio,
              timestamp: Date.now()
            });
          }
        };
        reader.readAsDataURL(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
        this.micStream = null;
      };
      
      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      
      const overlay = document.getElementById('recording-overlay');
      if (overlay) overlay.classList.remove('hidden');
      
      const durationEl = document.getElementById('rec-duration');
      this.recordingTimer = setInterval(() => {
        const duration = ((Date.now() - this.recordingStartTime) / 1000).toFixed(1);
        if (durationEl) durationEl.textContent = duration;
        
        // Max 15 seconds limit to prevent database overhead
        if (parseFloat(duration) >= 15) {
          this.stopRemoteRecording();
        }
      }, 100);
      
      const btn = document.getElementById('mic-toggle-btn');
      if (btn) {
        btn.classList.add('mic-active');
        btn.innerHTML = '<i data-lucide="mic-off"></i> ADÁS LEÁLLÍTÁSA';
        (window as any).lucide.createIcons();
      }
    } catch (err) {
      console.error('Remote recording failed:', err);
      alert('Nincs hozzáférés a mikrofonhoz a távoli adáshoz!');
    }
  }

  private stopRemoteRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
    
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
    
    const overlay = document.getElementById('recording-overlay');
    if (overlay) overlay.classList.add('hidden');
    
    const btn = document.getElementById('mic-toggle-btn');
    if (btn) {
      btn.classList.remove('mic-active');
      btn.innerHTML = '<i data-lucide="mic"></i> TÁVOLI HANGOSBEMONDÓ';
      (window as any).lucide.createIcons();
    }
  }

  // --- CORE APP LOGIC ---
  private addSchedule(type: 'in' | 'out') {
    const inputId = type === 'in' ? 'in-bell-time' : 'out-bell-time';
    const timeInput = document.getElementById(inputId) as HTMLInputElement;
    if (!timeInput.value) return;

    const newSchedule: BellSchedule = {
      id: crypto.randomUUID(),
      time: timeInput.value,
      type
    };

    const updatedSchedules = [...this.schedules, newSchedule];
    updatedSchedules.sort((a, b) => a.time.localeCompare(b.time));
    
    if (this.currentUser && firebaseDb) {
      set(ref(firebaseDb, `users/${this.currentUser.uid}/schedules`), updatedSchedules);
    } else {
      this.schedules = updatedSchedules;
      this.saveSchedulesLocally();
      this.renderSchedules();
    }
    timeInput.value = '';
  }

  private handleFileUpload(event: Event, type: 'in' | 'out') {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const fileName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      const audioData = e.target?.result as string;
      
      // Limit to 2.8MB base64 string size
      if (audioData.length > 2.8 * 1024 * 1024) {
        alert('A fájl mérete túl nagy! Kérlek válassz 2MB-nál kisebb hangot.');
        return;
      }

      if (this.currentUser && firebaseDb) {
        update(ref(firebaseDb, `users/${this.currentUser.uid}/settings`), {
          [type === 'in' ? 'audioIn' : 'audioOut']: {
            type: 'custom',
            name: fileName,
            data: audioData
          }
        });
      } else {
        if (type === 'in') {
          this.inBellAudio = new Audio(audioData);
        } else {
          this.outBellAudio = new Audio(audioData);
        }
        const nameEl = document.getElementById(`${type}-bell-name`);
        if (nameEl) nameEl.textContent = fileName;
        localStorage.setItem(`audio-${type}-type`, 'custom');
        localStorage.setItem(`audio-${type}`, audioData);
        localStorage.setItem(`audio-${type}-name`, fileName);
      }
    };
    reader.readAsDataURL(file);
  }

  private checkBells(now: Date) {
    const currentTime = now.toTimeString().slice(0, 5);
    const seconds = now.getSeconds();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    
    const weekendToggle = document.getElementById('weekend-ringing') as HTMLInputElement;
    const isWeekendRingingEnabled = weekendToggle ? weekendToggle.checked : false;

    // ONLY Receiver runs local schedules
    if (this.mode === 'receiver') {
      if (seconds === 0 && (!isWeekend || isWeekendRingingEnabled)) {
        const activeBells = this.schedules.filter(s => s.time === currentTime);
        activeBells.forEach(bell => this.playBell(bell.type));
      }
    }

    this.updateNextBell(currentTime, isWeekend && !isWeekendRingingEnabled);
  }

  private playBell(type: 'in' | 'out') {
    const audio = type === 'in' ? this.inBellAudio : this.outBellAudio;
    const durationInput = document.getElementById('bell-duration') as HTMLInputElement;
    const durationLimit = parseInt(durationInput.value) * 1000;

    if (audio) {
      try {
        audio.currentTime = 0;
        audio.play().then(() => {
          setTimeout(() => {
            audio.pause();
            audio.currentTime = 0;
          }, durationLimit);
        }).catch((err) => {
          console.error('Error playing bell:', err);
          this.showAutoplayWarning();
        });
      } catch (err) {
        console.error('Error playing bell:', err);
        this.showAutoplayWarning();
      }
    }
  }

  private triggerManualRing(type: 'in' | 'out') {
    if (this.mode === 'controller') {
      if (!this.currentUser || !firebaseDb) return;
      set(ref(firebaseDb, `users/${this.currentUser.uid}/live/triggerRing`), {
        type,
        timestamp: Date.now()
      });
    } else {
      this.playBell(type);
    }
  }

  private toggleFireAlarm() {
    if (this.currentUser && firebaseDb) {
      set(ref(firebaseDb, `users/${this.currentUser.uid}/live/fireAlarm`), !this.isFireAlarmPlaying);
    } else {
      this.toggleFireAlarmLocally(!this.isFireAlarmPlaying);
    }
  }

  private toggleFireAlarmLocally(isPlaying: boolean) {
    this.isFireAlarmPlaying = isPlaying;
    const btn = document.getElementById('fire-alarm-btn');
    
    if (isPlaying) {
      this.fireAlarmAudio?.play();
      btn?.classList.add('btn-pulse');
    } else {
      this.fireAlarmAudio?.pause();
      if (this.fireAlarmAudio) this.fireAlarmAudio.currentTime = 0;
      btn?.classList.remove('btn-pulse');
    }
  }

  private async toggleMic() {
    if (this.mode === 'controller') {
      if (this.isRecording) {
        this.stopRemoteRecording();
      } else {
        await this.startRemoteRecording();
      }
    } else {
      // Local Microphone Loopback
      const btn = document.getElementById('mic-toggle-btn');
      if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
        this.micSource?.disconnect();
        btn?.classList.remove('mic-active');
        btn!.innerHTML = '<i data-lucide="mic"></i> MIKROFON ADÁS';
        (window as any).lucide.createIcons();
      } else {
        try {
          const inSelect = document.getElementById('audio-input-select') as HTMLSelectElement;
          const deviceId = inSelect ? inSelect.value : 'default';
          
          const constraints = { 
              audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } } 
          };

          this.micStream = await navigator.mediaDevices.getUserMedia(constraints);
          if (!this.audioContext) this.audioContext = new AudioContext();
          this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
          this.micSource.connect(this.audioContext.destination);
          btn?.classList.add('mic-active');
          btn!.innerHTML = '<i data-lucide="mic-off"></i> LEÁLLÍTÁS';
          (window as any).lucide.createIcons();
        } catch (err) {
          console.error('Mic access denied', err);
          alert('Nincs hozzáférés a mikrofonhoz!');
        }
      }
    }
  }

  private renderSchedules() {
    const container = document.getElementById('schedule-rows')!;
    container.innerHTML = '';
    this.schedules.forEach(s => {
      const row = document.createElement('div');
      row.className = 'schedule-row';
      const color = s.type === 'in' ? 'var(--success-neon)' : 'var(--danger-neon)';
      const icon = s.type === 'in' ? 'bell' : 'bell-off';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem; color: ${color}">
          <i data-lucide="${icon}" style="width: 16px; height: 16px;"></i>
          <span style="font-weight: 700; font-size: 0.7rem; letter-spacing: 0.1em;">${s.type === 'in' ? 'BECSENGETÉS' : 'KICSENGETÉS'}</span>
        </div>
        <div style="font-family: var(--font-digital); font-size: 1.5rem; color: var(--accent-neon); margin: 0.5rem 0;">${s.time}</div>
        <button class="btn btn-neon-red" style="padding: 0.4rem; font-size: 0.7rem; border-radius: 8px; width: 100%;" onclick="window.app.deleteSchedule('${s.id}')">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> TÖRLÉS
        </button>
      `;
      container.appendChild(row);
    });
    (window as any).lucide?.createIcons();
  }

  public deleteSchedule(id: string) {
    const updatedSchedules = this.schedules.filter(s => s.id !== id);
    if (this.currentUser && firebaseDb) {
      set(ref(firebaseDb, `users/${this.currentUser.uid}/schedules`), updatedSchedules);
    } else {
      this.schedules = updatedSchedules;
      this.saveSchedulesLocally();
      this.renderSchedules();
    }
  }

  private saveSchedulesLocally() {
    localStorage.setItem('bell-schedules', JSON.stringify(this.schedules));
  }

  private loadSchedulesLocally() {
    const saved = localStorage.getItem('bell-schedules');
    if (saved) this.schedules = JSON.parse(saved);

    ['in', 'out'].forEach(type => {
        const audioType = localStorage.getItem(`audio-${type}-type`);
        const nameEl = document.getElementById(`${type}-bell-name`);
        const select = document.getElementById(`${type}-preset-select`) as HTMLSelectElement;

        if (audioType === 'preset') {
            const val = localStorage.getItem(`audio-${type}-value`);
            if (val !== null) {
                const preset = SchoolBellApp.BELL_PRESETS[parseInt(val)];
                if (preset) {
                    if (type === 'in') this.inBellAudio = new Audio(preset.url);
                    else this.outBellAudio = new Audio(preset.url);
                    if (nameEl) nameEl.textContent = preset.name;
                    if (select) select.value = val;
                }
            }
        } else if (audioType === 'custom') {
            const data = localStorage.getItem(`audio-${type}`);
            const name = localStorage.getItem(`audio-${type}-name`);
            if (data) {
                if (type === 'in') this.inBellAudio = new Audio(data);
                else this.outBellAudio = new Audio(data);
                if (nameEl && name) nameEl.textContent = name;
                if (select) select.value = 'custom';
            }
        }
    });

    const weekendRinging = localStorage.getItem('weekend-ringing');
    const weekendToggle = document.getElementById('weekend-ringing') as HTMLInputElement;
    if (weekendRinging !== null && weekendToggle) {
      weekendToggle.checked = weekendRinging === 'true';
    }

    this.renderSchedules();
  }

  private updateNextBell(currentTime: string, isWeekend: boolean) {
    const el = document.getElementById('next-bell')!;
    const statusEl = document.getElementById('bell-status-text')!;
    
    if (isWeekend) {
      el.textContent = 'HÉT-';
      if (statusEl) statusEl.textContent = 'VÉGE';
      return;
    }
    
    const next = this.schedules.find(s => s.time > currentTime);
    el.textContent = next ? next.time : '--:--';
    
    if (statusEl) {
      statusEl.textContent = next 
        ? (next.type === 'in' ? 'BECSENGETÉS JÖN' : 'KICSENGETÉS JÖN') 
        : 'NINCS TÖBB MÁRA';
    }
  }
}

// @ts-ignore
window.app = new SchoolBellApp();
export { SchoolBellApp };
