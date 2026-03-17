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

  constructor() {
    this.loadSchedules();
    this.initClock();
    this.setupEventListeners();
    this.initAudio();
    this.initDeviceSelection();
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
    setInterval(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('hu-HU', { hour12: false });
      clockEl.textContent = timeStr;
      this.checkBells(now);
    }, 1000);
  }

  private setupEventListeners() {
    document.getElementById('add-in-bell')?.addEventListener('click', () => this.addSchedule('in'));
    document.getElementById('add-out-bell')?.addEventListener('click', () => this.addSchedule('out'));
    
    document.getElementById('in-bell-file')?.addEventListener('change', (e) => this.handleFileUpload(e, 'in'));
    document.getElementById('out-bell-file')?.addEventListener('change', (e) => this.handleFileUpload(e, 'out'));

    document.getElementById('fire-alarm-btn')?.addEventListener('click', () => this.toggleFireAlarm());
    document.getElementById('mic-toggle-btn')?.addEventListener('click', () => this.toggleMic());
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

    const reader = new FileReader();
    reader.onload = (e) => {
      const audioData = e.target?.result as string;
      if (type === 'in') {
        this.inBellAudio = new Audio(audioData);
      } else {
        this.outBellAudio = new Audio(audioData);
      }
      localStorage.setItem(`audio-${type}`, audioData);
    };
    reader.readAsDataURL(file);
  }

  private checkBells(now: Date) {
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM
    const seconds = now.getSeconds();

    if (seconds === 0) {
      const activeBells = this.schedules.filter(s => s.time === currentTime);
      activeBells.forEach(bell => this.playBell(bell.type));
    }

    this.updateNextBell(currentTime);
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
      btn!.innerHTML = '🎤 MIKROFON';
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
        btn!.innerHTML = '🎤 ADÁSBA';
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
      row.innerHTML = `
        <span style="font-weight: 600; color: ${s.type === 'in' ? '#4ade80' : '#f472b6'}">
          ${s.type === 'in' ? '🔔 BECSENGETÉS' : '🔕 KICSENGETÉS'}
        </span>
        <span style="font-size: 1.25rem;">${s.time}</span>
        <button class="btn btn-danger" style="padding: 0.5rem; font-size: 0.8rem;" onclick="window.app.deleteSchedule('${s.id}')">Törlés</button>
      `;
      container.appendChild(row);
    });
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

    const inAudioData = localStorage.getItem('audio-in');
    if (inAudioData) this.inBellAudio = new Audio(inAudioData);

    const outAudioData = localStorage.getItem('audio-out');
    if (outAudioData) this.outBellAudio = new Audio(outAudioData);

    this.renderSchedules();
  }

  private updateNextBell(currentTime: string) {
    const next = this.schedules.find(s => s.time > currentTime);
    const el = document.getElementById('next-bell')!;
    el.textContent = next ? next.time : '--:--';
  }
}

// @ts-ignore
window.app = new SchoolBellApp();
