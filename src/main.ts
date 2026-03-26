import './style.css'

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
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

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
    this.loadSchedules();
    this.initClock();
    this.setupEventListeners();
    this.initAudio();
    this.initDeviceSelection();
  }

  private initPresetSelectors() {
    ['in', 'out'].forEach(type => {
      const select = document.getElementById(`${type}-preset-select`) as HTMLSelectElement;
      if (select) {
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

  private initAudio() {
    // Initializing the AudioContext for mic
    if (!this.audioContext) this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Fire alarm audio (realistic sound)
    this.fireAlarmAudio = new Audio('https://www.orangefreesounds.com/wp-content/uploads/2014/12/Fire-alarm-sound.mp3');
    this.fireAlarmAudio.loop = true;
  }

  private async initDeviceSelection() {
    await this.refreshDevices();

    // Re-check devices when they change (plugged/unplugged)
    navigator.mediaDevices.ondevicechange = () => this.refreshDevices();

    document.getElementById('audio-output-select')?.addEventListener('change', (e) => {
        const deviceId = (e.target as HTMLSelectElement).value;
        this.updateAudioOutput(deviceId);
    });

    document.getElementById('refresh-devices-btn')?.addEventListener('click', () => this.refreshDevices());
  }

  private async refreshDevices() {
    try {
        // Request temporary mic access to get named devices (privacy requirement)
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        const inputs = devices.filter(d => d.kind === 'audioinput');

        const outSelect = document.getElementById('audio-output-select') as HTMLSelectElement;
        const inSelect = document.getElementById('audio-input-select') as HTMLSelectElement;

        if (outSelect) {
            outSelect.innerHTML = '<option value="default">Alapértelmezett</option>';
            outputs.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.deviceId;
                opt.textContent = d.label || `Eszköz (${d.deviceId.slice(0, 5)})`;
                outSelect.appendChild(opt);
            });
        }

        if (inSelect) {
            inSelect.innerHTML = '<option value="default">Alapértelmezett</option>';
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
    // Web Audio API Context output
    if (this.audioContext && (this.audioContext as any).setSinkId) {
        try {
            await (this.audioContext as any).setSinkId(deviceId);
        } catch (err) {
            console.error('Context SinkId error:', err);
        }
    }

    // HTML5 Audio elements
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
    const update = () => {
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
    update();
    setInterval(update, 1000);
  }

  private setupEventListeners() {
    document.getElementById('add-in-bell')?.addEventListener('click', () => this.addSchedule('in'));
    document.getElementById('add-out-bell')?.addEventListener('click', () => this.addSchedule('out'));
    
    document.getElementById('in-bell-file')?.addEventListener('change', (e) => this.handleFileUpload(e, 'in'));
    document.getElementById('out-bell-file')?.addEventListener('change', (e) => this.handleFileUpload(e, 'out'));

    document.getElementById('fire-alarm-btn')?.addEventListener('click', () => this.toggleFireAlarm());
    document.getElementById('mic-toggle-btn')?.addEventListener('click', () => this.toggleMic());
    document.getElementById('manual-ring-btn')?.addEventListener('click', () => this.playBell('in'));

    document.getElementById('weekend-ringing')?.addEventListener('change', () => {
      const isChecked = (document.getElementById('weekend-ringing') as HTMLInputElement).checked;
      localStorage.setItem('weekend-ringing', isChecked ? 'true' : 'false');
    });

    document.getElementById('in-preset-select')?.addEventListener('change', (e) => this.handlePresetSelection(e, 'in'));
    document.getElementById('out-preset-select')?.addEventListener('change', (e) => this.handlePresetSelection(e, 'out'));
  }

  private addSchedule(type: 'in' | 'out') {
    const inputId = type === 'in' ? 'in-bell-time' : 'out-bell-time';
    const timeInput = document.getElementById(inputId) as HTMLInputElement;
    if (!timeInput.value) return;

    const newSchedule: BellSchedule = {
      id: crypto.randomUUID(),
      time: timeInput.value,
      type
    };

    this.schedules.push(newSchedule);
    this.schedules.sort((a, b) => a.time.localeCompare(b.time));
    this.saveSchedules();
    this.renderSchedules();
    timeInput.value = '';
  }

  private handleFileUpload(event: Event, type: 'in' | 'out') {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const fileName = file.name;
    const nameEl = document.getElementById(`${type}-bell-name`);
    if (nameEl) nameEl.textContent = fileName;

    const reader = new FileReader();
    reader.onload = (e) => {
      const audioData = e.target?.result as string;
      if (type === 'in') {
        this.inBellAudio = new Audio(audioData);
      } else {
        this.outBellAudio = new Audio(audioData);
      }
      localStorage.setItem(`audio-${type}`, audioData);
      localStorage.setItem(`audio-${type}-name`, fileName);
    };
    reader.readAsDataURL(file);
  }

  private checkBells(now: Date) {
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const seconds = now.getSeconds();
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    const weekendToggle = document.getElementById('weekend-ringing') as HTMLInputElement;
    const isWeekendRingingEnabled = weekendToggle ? weekendToggle.checked : false;

    if (seconds === 0 && (!isWeekend || isWeekendRingingEnabled)) {
      const activeBells = this.schedules.filter(s => s.time === currentTime);
      activeBells.forEach(bell => this.playBell(bell.type));
    }

    this.updateNextBell(currentTime, isWeekend && !isWeekendRingingEnabled);
  }

  private playBell(type: 'in' | 'out') {
    const audio = type === 'in' ? this.inBellAudio : this.outBellAudio;
    const durationInput = document.getElementById('bell-duration') as HTMLInputElement;
    const durationLimit = parseInt(durationInput.value) * 1000;

    if (audio) {
      audio.currentTime = 0;
      audio.play();
      setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
      }, durationLimit);
    }
  }

  private toggleFireAlarm() {
    if (this.isFireAlarmPlaying) {
      this.fireAlarmAudio?.pause();
      if (this.fireAlarmAudio) this.fireAlarmAudio.currentTime = 0;
      document.getElementById('fire-alarm-btn')?.classList.remove('btn-pulse');
    } else {
      this.fireAlarmAudio?.play();
      document.getElementById('fire-alarm-btn')?.classList.add('btn-pulse');
    }
    this.isFireAlarmPlaying = !this.isFireAlarmPlaying;
  }

  private async toggleMic() {
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
    this.schedules = this.schedules.filter(s => s.id !== id);
    this.saveSchedules();
    this.renderSchedules();
  }

  private saveSchedules() {
    localStorage.setItem('bell-schedules', JSON.stringify(this.schedules));
  }

  private loadSchedules() {
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
