/*
   Written by goto at kmgoto.jp (Mar. 2021)
   Copyright of my code is not claimed.

   Based on soundtouchjs/src/PitchShifter.js, SimpleFilter.js

   Modified for use as intermediate ScriptProcessorNode.
   Note: Output does not work for OfflineAudioContext.

   1) PitchShifter ---> MyPitchShifter (minimum code)
                     includes ScriptProcessorNode
       or --> MyPitchShifternode (AudioWorkletNode)

   2) MyFilter extends SimpleFilter

   Pitch modification and slow down/speed up work.
   Slow down only for real-time playback.
   Fast real-time playback is impossible by nature.

   3) AudioWorklet is in public/worklet/ 
      (public is the document root.)

 */

import { Component } from 'react';
import './App.css';
import MyPitchShifter from './jslibs/MyPitchShifter'; // soundtouchJS
import MyPitchShifterWorkletNode from './jslibs/MyPitchShifterWorkletNode';
// UI Components
import PlayButton from './jslibs/PlayButton';
import SpeedPitchControls from './jslibs/SpeedPitchControls';
import TrackGainSliderList from './jslibs/TrackGainSliderList';

import packageJSON from '../package.json';
import messages from './messages.json'; // English/Japanese messages

// material-ui Icons, Tooltip
import { IconButton, Tooltip } from '@material-ui/core';
import StopOutlinedIcon from '@material-ui/icons/StopOutlined';
import LoopOutlinedIcon from '@material-ui/icons/LoopOutlined';
import GetAppIcon from '@material-ui/icons/GetApp';
import PlayCircleFilledWhiteIcon
  from '@material-ui/icons/PlayCircleFilledWhite';
import NotInterestedIcon from '@material-ui/icons/NotInterested';
import MoodIcon from '@material-ui/icons/Mood';
import MicIcon from '@material-ui/icons/Mic';
import AddIcon from '@material-ui/icons/Add';
import RemoveIcon from '@material-ui/icons/Remove';
// import { AudioContext, OfflineAudioContext }  from 'standardized-audio-context';

// get subversion string 
const version = packageJSON.subversion;

// alert(navigator.userAgent);

// switch languages
let defaultLang = 'en';
let m = messages.en;
console.log(window.navigator.language);
if (window.navigator.language.slice(0, 2) === 'ja') {
  defaultLang = 'ja';
  m = messages.ja;
}

/*
let iOS = false;
if(  navigator.userAgent.match(/iPhone/i) 
  || navigator.userAgent.match(/iPod/i)
  || navigator.userAgent.match(/iPad/i)){
  iOS = true;
}
*/

// AudioWorklet check with OfflineAudioContext (from Google Labs example)
let tmp = false;
if (OfflineAudioContext) {
  tmp = true;
  console.log('OfflineAudioContext available');
} else tmp = false;
const isOfflineAudioContext = tmp;

//let context = new OfflineAudioContext(1, 1, 44100);

let isAudioWorkletNode = false;
if (AudioWorkletNode || window.webkit.AudioWorkletNode) {
  isAudioWorkletNode = true;
  console.log('AudioWorkletNode available');
}

let context = new AudioContext();
let isAudioWorklet = false;
if (context.audioWorklet &&
  typeof context.audioWorklet.addModule === 'function') {
  isAudioWorklet = true;
  console.log('Audiocontext.AudioWorklet available');
}
context.close();

const isAudioWorkletAvailable = (isAudioWorkletNode & isAudioWorklet);

class App extends Component {

  constructor(props) {
    super();
    this.audioCtx = null;
    this.inputAudio = [];
    this.mixedSource = null;
    this.masterGainNode = null;

    this.state = {
      language: defaultLang,
      isPlaying: false,
      timeA: 0,
      playingAt: 0,
      timeB: 0,
      loop: false,
      loopDelay: 2,
      playButtonNextAction: 'load files first!',
      gains: [],
      masterGain: 75,
      playSpeed: 1.0,
      playPitch: 0.0,
      bypass: false,
      useAudioWorklet: isAudioWorkletAvailable,
      micOn: false,
      micDelay: 0.2,
      weAreRecord: false
    };

    this.shifter = null;

    this.loadFiles = this.loadFiles.bind(this);
    this.handlePlay = this.handlePlay.bind(this);
    this.handleGainSlider = this.handleGainSlider.bind(this);
    this.handleTimeSlider = this.handleTimeSlider.bind(this);
    this.playAB = this.playAB.bind(this);
    this.setSpeed = this.setSpeed.bind(this);
    this.setPitch = this.setPitch.bind(this);
    this.switchLanguage = this.switchLanguage.bind(this);
    this.loadFilesFromWeb();

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.recordedAudio = null;
  }

  componentWillUnmount() { // before closing app
    if (this.audioCtx !== null) this.audioCtx.close();
  }


  render() {

    return (
      <div className="App">
        {m.title}
        <br />
        <center>
          (language) &ensp;
     <span className='tiny-button'>
            <Tooltip title={m.switchLang}>
              <button onClick={this.switchLanguage}>
                {this.state.language === 'ja' ? 'EN' : 'JP'}</button>
            </Tooltip>
          </span>
     &ensp;(AudioWorklet)
     <Tooltip title={m.worklet}>
            <IconButton name='toggleWorklet'
              onClick={
                () => {
                  if (isAudioWorkletNode)
                    this.setState({ useAudioWorklet: !this.state.useAudioWorklet });
                }
              } >
              <MoodIcon color={this.state.useAudioWorklet ? 'primary' : 'disabled'} />
            </IconButton>
          </Tooltip>
        </center>
        <hr />
        <span className="selectFile">
          <Tooltip title={m.fileReader}>
            <input type="file" name="loadFiles" multiple
              accept="audio/*" onChange={this.loadFiles} />
          </Tooltip>
     &emsp;<span className='tiny-button'>
            <Tooltip title={m.clearFiles}>
              <button name='clearFile' onClick={() => {
                this.setState({
                  gains: [],
                  playButtonNextAction: 'load files first!'
                });
                this.inputAudio = [];
              }}
              >{m.clearButton}</button></Tooltip></span>
          <br />
        </span><br />
        <div className='text-divider'>{m.timeTitle}&nbsp;
      ({m.timeSliderPosition}:&nbsp;
       <font color='green'>{this.state.playingAt.toFixed(2)}</font>)
     </div>
        <center>
          A: {this.state.timeA.toFixed(2)} -- B: {this.state.timeB.toFixed(2)}
     &emsp; song length: {this.inputAudio[0] ?
            this.inputAudio[0].data.duration.toFixed(2) : 0.00}
          <br />
          <div className='slider'>
            <Tooltip title={m.timeSlider}>
              <input type='range' name='timeSlider'
                min='0' max={this.inputAudio[0] ?
                  this.inputAudio[0].data.duration : 0}
                value={this.state.playingAt}
                onChange={this.handleTimeSlider}
              />
            </Tooltip>
          </div>
          <span className='tiny-button'>
            <Tooltip title={m.setA}>
              <button name='setA'
                onClick={() => this.setState({ timeA: this.state.playingAt })}>
                set A
     </button>
            </Tooltip>
      &emsp;
     <Tooltip title={m.setB}>
              <button name='setB'
                onClick={() => this.setState({ timeB: this.state.playingAt })}>
                set B
     </button>
            </Tooltip>
      &emsp;
     <Tooltip title={m.resetAB}>
              <button name='reset'
                onClick={() => this.setState({ timeA: 0, timeB: this.inputAudio[0].data.duration })}>reset
     </button>
            </Tooltip>
          </span>
        </center>

        <div className='text-divider'>{m.playerTitle}</div>
        <center>
          <Tooltip title={m.record}>
            <IconButton
              onClick={() => this.handlePlay({ target: { name: 'recordPlayMix' } })} >
              <MicIcon color={this.state.micOn ? 'secondary' : 'primary'} />
            </IconButton>
          </Tooltip>
          <PlayButton
            nextAction={this.state.playButtonNextAction}
            handler={this.handlePlay}
            messages={m}
          />
          <Tooltip title={m.stopButton}>
            <IconButton
              onClick={() => this.handlePlay({ target: { name: 'stop' } })} >
              <StopOutlinedIcon
                color={this.inputAudio.length ? 'primary' : 'disabled'} />
            </IconButton>
          </Tooltip>
          <Tooltip title={m.loopButton}>
            <IconButton
              onClick={() => { this.setState({ loop: !this.state.loop }); }} >
              <LoopOutlinedIcon
                color={this.state.loop ? 'secondary' : 'primary'} />
            </IconButton>
          </Tooltip>

          <Tooltip title={m.exportButton} aria-label='exportFile'>
            <IconButton
              onClick={() => this.handlePlay({ target: { name: 'exportFile' } })} >
              <GetAppIcon
                color={!this.inputAudio.length || this.state.isPlaying ? 'disabled' : 'primary'} />
            </IconButton>
          </Tooltip>

          <Tooltip title={m.playMixButton} aria-label='playMix'>
            <IconButton
              onClick={() => this.handlePlay({ target: { name: 'playMix' } })} >
              <PlayCircleFilledWhiteIcon
                color={!this.inputAudio.length || this.state.isPlaying ? 'disabled' : 'primary'} />
            </IconButton>
          </Tooltip>
          <Tooltip title={m.bypassButton}>
            <IconButton
              onClick={() => this.setState({ bypass: !this.state.bypass })}>
              <NotInterestedIcon
                color={this.state.bypass ? 'disabled' : 'primary'} />
            </IconButton>
          </Tooltip>

        </center>

        {this.state.bypass ? '' :
          <SpeedPitchControls
            playSpeed={this.state.playSpeed}
            playPitch={this.state.playPitch}
            setSpeed={this.setSpeed}
            setPitch={this.setPitch}
            messages={m}
          />
        }

        <div className='slider' key='master'>
          <div className='text-divider'>{m.masterGainTitle}&nbsp;
       ({this.state.masterGain})</div>
          <center>
            0 <input type='range' id='master' name='gainSlider'
              min='0' max='150' value={this.state.masterGain}
              onChange={this.handleGainSlider} /> 150
       </center>
        </div>
        <div className='text-divider'>{m.trackGainTitle}</div>
        <TrackGainSliderList
          inputAudio={this.inputAudio}
          gains={this.state.gains}
          handler={this.handleGainSlider}
        />

        {this.state.weAreRecord ?

          <span>
            <span>
              <div className='text-divider'>
                Current Delay: <font color='green'>{this.state.micDelay.toFixed(2)}</font>

              </div>

              <center>
                <IconButton disabled={this.state.micDelay == 0}
                  onClick={() => this.setState({ micDelay: this.state.micDelay - 0.1 })} >
                  <RemoveIcon color='primary' /> </IconButton>
                <IconButton
                  onClick={() => this.setState({ micDelay: this.state.micDelay + 0.1 })} >
                  <AddIcon color='primary' /> </IconButton>

              </center>

            </span>

          </span>
          : ""
        }



        <hr />
        {m.version}: {version} &nbsp;&nbsp;
        <a href={m.url}
          target='_blank' rel='noreferrer'>{m.guide}</a><br />
        {m.credit}&nbsp;
        <a href="https://github.com/cutterbl/SoundTouchJS"
          target='_blank' rel='noreferrer'>SoundTouchJs</a><br />
        <hr />
      </div>
    );
  }

  async loadFiles(event) {

    if (event.target.name !== 'loadFiles') return;
    if (event.target.files.length === 0) return;
    const files = event.target.files;

    console.log('loadFiles');
    if (this.audioCtx === null) {
      console.log('AudioContext');
      try {
        this.audioCtx = new AudioContext();
        await this.loadModule(this.audioCtx, 'worklet/bundle.js');
        console.log('AudioContext worklet module loaded');
      } catch (error) {
        console.log(error);
      }
    }

    for (let i = 0; i < files.length; i++) {
      const reader = new FileReader();

      reader.onload = function (e) {
        this.audioCtx.decodeAudioData(reader.result,
          function (audioBuffer) {
            if (audioBuffer.numberOfChannels !== 2) {
              alert('Sorry, only stereo files are supported');
              return;
            }
            this.inputAudio.push({
              name: files[i].name,
              data: audioBuffer,
              source: null,
              gainNode: null,
              gain: 100,
            });

            const gains = this.state.gains; gains.push(100);

            this.setState({
              playButtonNextAction: 'Play',
              timeA: 0,
              playingAt: 0,
              timeB: this.inputAudio[0].data.duration,
              gains: gains,
            });

            // this.inputAudio.sort((a,b) => a.name - b.name); // mmm.. does not work

          }.bind(this),

          function (error) { console.log("decode error: " + error.err) }
        )

      }.bind(this)

      reader.onerror = function (e) { console.log("File read ", reader.error); }
      reader.readAsArrayBuffer(files[i]);

    } // end for

  } // end loadFiles()

  async loadFilesFromWeb() {
    console.log('loadFilesFromWeb');

    const tracks = [
      {
        name: "Il_gatto_e_la_volpe_voce_principale_cantare",
        url: "/music/008_02_Il_gatto_e_la_volpe_voce_principale_cantare.webm"
      },
      {
        name: "Il_gatto_e_la_volpe_seconde voci_cantare",
        url: "/music/008_03_Il_gatto_e_la_volpe_seconde voci_cantare.webm"
      },
      {
        name: "Il_gatto_e_la_volpe_kazoo_cantare",
        url: "/music/008_04_Il_gatto_e_la_volpe_kazoo_cantare.webm"
      },
      {
        name: "Il_gatto_e_la_volpe_armonie_cantare",
        url: "/music/008_05_Il_gatto_e_la_volpe_armonie_cantare.webm"
      },
      {
        name: "Il_gatto_e_la_volpe_batteria_cantare",
        url: "/music/008_06_Il_gatto_e_la_volpe_batteria_cantare.webm"
      },
      {
        name: "Il_gatto_e_la_volpe_basso_cantare",
        url: "/music/008_07_Il_gatto_e_la_volpe_basso_cantare.webm"
      }
    ]

    if (this.audioCtx === null) {
      console.log('AudioContext');
      try {
        this.audioCtx = new AudioContext();
        await this.loadModule(this.audioCtx, 'worklet/bundle.js');
        console.log('AudioContext worklet module loaded');
      } catch (error) {
        console.log(error);
      }
    }

    const promiseArray = []
    tracks.forEach(t => {
      promiseArray.push(fetch(t.url).then(r => r.arrayBuffer()).then(buf => { return { name: t.name, buffer: buf } }));
    })

    Promise.all(promiseArray).then(allBuffers => {
      console.log(allBuffers);
      allBuffers.forEach(b => {
        this.audioCtx.decodeAudioData(b.buffer, (audioBuffer) => {
          if (audioBuffer.numberOfChannels !== 2) {
            alert('Sorry, only stereo files are supported');
            return;
          }
          this.inputAudio.push({
            name: b.name,
            data: audioBuffer,
            source: null,
            gainNode: null,
            gain: 100,
          });

          const gains = this.state.gains; gains.push(100);

          this.setState({
            playButtonNextAction: 'Play',
            timeA: 0,
            playingAt: 0,
            timeB: this.inputAudio[0].data.duration,
            gains: gains,
          });
        })
      })
    })
  } // end loadFilesFromWeb()

  handleTimeSlider(event) {

    if (event.target.name !== 'timeSlider') return;

    if (!this.state.isPlaying)
      this.setState({ playingAt: parseFloat(event.target.value) });
  }

  handlePlay(event) {

    console.log('handlePlay name/button',
      event.target.name, this.state.playButtonNextAction);

    if (this.inputAudio.length === 0) alert(m.alert);

    if (event.target.name === 'startPause') {

      switch (this.state.playButtonNextAction) {

        case 'Pause':
          console.log('Pause');
          if (this.audioCtx) this.audioCtx.suspend();
          this.setState({
            playButtonNextAction: 'Resume',
            isPlaying: false
          });
          break;

        case 'Resume':
          console.log('Resume');
          if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
          this.setState({
            playButtonNextAction: 'Pause',
            isPlaying: true
          });
          break;

        case 'Play':
          console.log('Play');
          if (this.inputAudio.length === 0) break;
          this.playAB(1, this.state.timeA, this.state.timeB);

          this.setState({ playButtonNextAction: 'Pause' })
          break;

        default:
          console.log('default', this.state.playButtonNextAction);
      }

      return;
    }

    if (event.target.name === 'stop') {
      if (this.shifter) this.shifter.stop();
      if (this.mixedSource) this.mixedSource.stop();
      if (this.mediaRecorder) {
        this.mediaRecorder.stop();
        this.mediaRecorder = null;
      }

      this.setState({
        loop: false, playButtonNextAction: 'Play', playingAt:
          this.state.timeA
      })
      return;
    }

    if (event.target.name === 'exportFile'
      || event.target.name === 'playMix') {
      if (this.inputAudio.length === 0 || this.state.isPlaying) return;

      const recording = true;
      let offline = isOfflineAudioContext;
      // if (iOS) { offline = false; }
      this.playAB(1, this.state.timeA, this.state.timeB,
        recording, offline, event.target.name);

      return;
    }

    if (event.target.name === 'recordPlayMix') {
      if (this.inputAudio.length === 0 || this.state.isPlaying) return;

      const recording = true;
      let offline = isOfflineAudioContext;
      // if (iOS) { offline = false; }
      this.playAB(0, this.state.timeA, this.state.timeB,
        recording, offline, event.target.name);

      return;
    }

  } // end handlePlay()

  handleGainSlider(event) {
    if (event.target.name !== 'gainSlider') return;
    //       console.log ('slider id= ', event.target.id);
    // 
    if (event.target.id === 'master') {
      this.setState({ masterGain: parseFloat(event.target.value) });
      if (this.masterGainNode)
        this.masterGainNode.gain.value = parseFloat(event.target.value / 100.0);
      return;
    }

    const index = parseInt(event.target.id);

    const gains = this.state.gains;
    gains[index] = parseInt(event.target.value);
    this.setState({ gains: gains });
    if (this.inputAudio[index].gainNode !== null)
      this.inputAudio[index].gainNode.gain.value
        = parseFloat(event.target.value / 100.0);

  } // End handleGainSlider()

  setSpeed(e) {
    let speed = this.state.playSpeed;
    switch (e.target.name) {
      case 'sub10': speed -= 0.1; break;
      case 'add10': speed += 0.1; break;
      case 'sub1': speed -= 0.01; break;
      case 'add1': speed += 0.01; break;
      default:
    }
    if (speed < 0.5) speed = 0.5;
    else if (speed > 2.0) speed = 2.0;

    if (this.shifter) this.shifter.tempo = speed;

    this.setState({ playSpeed: speed });
  } // End set speed

  setPitch(e) {
    let pitch = this.state.playPitch;
    switch (e.target.name) {
      case 'sub1': pitch -= 1; break;
      case 'add1': pitch += 1; break;
      case 'sub10c': pitch -= 0.1; break;
      case 'add10c': pitch += 0.1; break;
      default:
    }

    if (pitch < -12) pitch = -12.0;
    else if (pitch > 12) pitch = 12.0

    if (this.shifter) this.shifter.pitch = Math.pow(2.0, pitch / 12.0);

    this.setState({ playPitch: pitch });

  } // End setPitch

  switchLanguage(e) {

    if (this.state.language === 'ja') {
      m = messages.en;
      this.setState({ language: 'en' });
    } else {
      m = messages.ja;
      this.setState({ language: 'ja' });
    }
  } // End switchLanguage()

  async playAB(delay, timeA, timeB, recording = false,
    offline = false, exporter = 'none') {

    console.log('playAB',
      'delay, timeA, timeB, recording, offline, exporter = ',
      delay, timeA, timeB, recording, offline, exporter);

    if (this.state.isPlaying) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    const sampleRate = this.inputAudio[0].data.sampleRate;
    const channels = this.inputAudio[0].data.numberOfChannels;
    const nInputFrames = (timeB - timeA) * sampleRate;
    const nOutputFrames = Math.max(nInputFrames,
      nInputFrames / this.state.playSpeed);

    let context = null;
    if (offline) {
      context = new OfflineAudioContext(
        channels,
        nOutputFrames * 1.1, // add extra 10%
        sampleRate
      );
      await this.loadModule(context, 'worklet/bundle.js');
      console.log('OfflineAudioContext Worklet module loaded');
    } else context = this.audioCtx;

    this.setState({ isPlaying: true });

    let updateInterval = 1.0;
    if (offline) updateInterval = 10.0;

    const options = {
      processorOptions: {
        bypass: this.state.bypass,
        recording: recording,
        nInputFrames: nInputFrames,
        updateInterval: updateInterval,
        sampleRate: sampleRate
      },
    };

    let shifter = null;
    if (!this.state.useAudioWorklet || offline) {
      // Offline worklet not working perfectly yet
      shifter = new MyPitchShifter(context, nInputFrames,
        4096, recording, this.state.bypass); // ScriptProcessorNode
      shifter.updateInterval = updateInterval;
    } else { // load the same worklet for OfflineAudioContext
      try {
        shifter = new MyPitchShifterWorkletNode(context,
          'my-soundtouch-processor', options); // ScriptProcessorNode
        shifter.updateInterval = updateInterval;
        console.log('AudioWorkletNode functional');
      } catch (err) {
        console.log(err);
        shifter = null;
        shifter = new MyPitchShifter(context, nInputFrames,
          4096, recording, this.state.bypass); // ScriptProcessorNode
        shifter.updateInterval = updateInterval;
        console.log('Worklet failed. Fallback to ScriptProcessorNode');
        // Creation of shifter does not work for Online (reason unknown)

      }
    } // end if useAudioWorklet 

    if (!offline) this.shifter = shifter;

    shifter.tempo = this.state.playSpeed;
    shifter.pitch = Math.pow(2.0, this.state.playPitch / 12.0);

    for (let i = 0; i < this.inputAudio.length; i++) {
      const source = context.createBufferSource();
      if (i === 0)
        source.buffer = this.addZeros(context, this.inputAudio[i].data);
      else source.buffer = this.inputAudio[i].data;
      this.inputAudio[i].source = source;
      const gainNode = context.createGain();
      gainNode.gain.value = this.state.gains[i] / 100.0;
      this.inputAudio[i].gainNode = gainNode;
      source.connect(gainNode);
      gainNode.connect(shifter.node);
    }


    if (!offline) {
      const masterGainNode = context.createGain();
      masterGainNode.gain.value = this.state.masterGain / 100.0;
      this.masterGainNode = masterGainNode;
      shifter.node.connect(masterGainNode);
      masterGainNode.connect(context.destination);
    } else shifter.node.connect(context.destination);

    if (this.state.weAreRecord) {
      for (let i = 0; i < this.inputAudio.length; i++) {
        if (this.inputAudio[i].name == "record")
          this.inputAudio[i].source.start(context.currentTime + delay, timeA);
        else { this.inputAudio[i].source.start(context.currentTime + delay + this.state.micDelay, timeA); }
      }
    } else {
      for (let i = 0; i < this.inputAudio.length; i++) {
        this.inputAudio[i].source.start(context.currentTime + delay, timeA);
      }
    }
    if (offline) {
      console.log('startRendering');
      context.startRendering();
    }

    /*
    this.inputAudio[0].source.onended = function(e) {
      console.log('source 0 onended');
      if (this.state.playingAt < timeB) { 
        shifter.stop(); 
        this.setState({isPlaying: false, playButtonNextAction: 'Play',
        playingAt: this.state.timeA});
      }
    }.bind(this);
    */

    shifter.onUpdate = function (val) {
      this.setState({ playingAt: timeA + val });
    }.bind(this);

    if (offline) {
      context.oncomplete = function (e) {
        console.log(
          'Offline render complete (data is useless though) length = ',
          e.renderedBuffer.length);
      }
    }

    shifter.onEnd = function (recordedBuffer) {
      // recordedBuffer made in shifter from worklet's message data
      console.log('shifter onEnd');

      for (let i = 0; i < this.inputAudio.length; i++)
        this.inputAudio[i].gainNode.disconnect();

      this.setState({ isPlaying: false });

      if (exporter === 'exportFile') {
        console.log('exportFile', recordedBuffer.length);
        shifter.exportToFile('mix_' + Date.now() + '.wav');
        this.setState({ isPlaying: false }); // audioBuffer is in the shifter
      } else if (exporter === 'playMix') {
        console.log('playMix', recordedBuffer.length);
        const context = this.audioCtx;
        this.setState({ isPlaying: true, playButtonNextAction: 'Pause' });
        const source = context.createBufferSource();
        this.mixedSource = source;
        source.buffer = recordedBuffer;
        const masterGainNode = context.createGain();
        this.masterGainNode = masterGainNode;
        masterGainNode.gain.value = this.state.masterGain / 100;
        source.connect(this.masterGainNode);
        masterGainNode.connect(context.destination);
        source.start();

        source.onended = function (e) {
          this.mixedSource = null;
          this.setState({ isPlaying: false });
        }.bind(this);

      } else if (exporter === 'recordPlayMix') {

        console.log('recordPlayMix');
        const context = this.audioCtx;
        this.setState({ isPlaying: true, playButtonNextAction: 'Pause' });
        const source = context.createBufferSource();
        this.mixedSource = source;
        source.buffer = recordedBuffer;
        const masterGainNode = context.createGain();
        this.masterGainNode = masterGainNode;
        masterGainNode.gain.value = this.state.masterGain / 100;
        source.connect(this.masterGainNode);
        masterGainNode.connect(context.destination);


        //MIC
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          console.log('getUserMedia supported.');
          navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
              this.mediaRecorder = new MediaRecorder(stream);
              this.mediaRecorder.ondataavailable = e => {
                this.recordedChunks.push(e.data);
              }
              this.mediaRecorder.onstop = e => {
                console.log("recorder stopped", e);

                const blob = new Blob(this.recordedChunks);
                this.recordedChunks = [];

                let fileReader = new FileReader();

                fileReader.onloadend = () => {

                  this.audioCtx.decodeAudioData(fileReader.result,
                    function (audioBuffer) {
                      if (audioBuffer.numberOfChannels !== 2) {
                        alert('Sorry, only stereo files are supported');
                        //return;
                      }
                      this.inputAudio.push({
                        name: "record",
                        data: audioBuffer,
                        source: null,
                        gainNode: null,
                        gain: 100,
                      });

                      const gains = this.state.gains; gains.push(100);

                      this.setState({
                        playButtonNextAction: 'Play',
                        timeA: 0,
                        playingAt: 0,
                        //timeB: this.inputAudio[0].data.duration,
                        gains: gains,
                      });
                      this.setState({ weAreRecord: true });

                    }.bind(this),

                    function (error) { console.log("decode error: " + error.err) }
                  )

                }

                fileReader.readAsArrayBuffer(blob);

              }
              this.mediaRecorder.start();
              source.start();
            })

            // Error callback
            .catch(function (err) {
              console.log('The following getUserMedia error occurred: ' + err);
            }
            );
        } else {
          console.log('getUserMedia not supported on your browser!');
        }



        source.onended = function (e) {
          this.mixedSource = null;
          this.setState({ isPlaying: false });
        }.bind(this);

      } //end elseif recordPlayMix

    }.bind(this);

  } // END playAB

  async loadModule(
    context, filename, moduleName, workletOptions) {
    if (!context) return false;
    let name = context.constructor.name;

    try {
      await context.audioWorklet.addModule(filename);
      //console.log(name, 'AudioWorklet loaded');
    } catch (e) {
      console.log(e, name, 'AudioWorklet load failed');
      return null
    }

    return true;
  }

  addZeros(context, input) { // return zero padded double length AudioBuffer
    console.log('addZeros');
    const output = context.createBuffer(
      input.numberOfChannels,
      input.length * 2 * 1.05, // extra 5%
      input.sampleRate
    ); // additional 5 sec

    for (let ch = 0; ch < output.numberOfChannels; ch++) {
      const inSamples = input.getChannelData(ch);
      const outSamples = output.getChannelData(ch);
      outSamples.set(inSamples);
    }

    return output;
  } // End addZeros()

}; // end class

export default App;
