import {SimpleFilter} from 'soundtouchjs'; 

const noop = function () {return;}

export default class MyFilter extends SimpleFilter {
  constructor(pipe, callback = noop){
    super(null, pipe, callback); // sourceSound, callback are not used
    this.callback = callback;
    this.sourceSound = [];
    this.historyBufferSize = 22050;
    this._sourcePosition = 0;
    this.outputBufferPosition = 0;
    this._position = 0;
  }

/* new method to put samples from e.inputBuffer in onaudioprocess */
  putSource(source){ 
    for (let i = 0; i < source.length; i++) 
       this.sourceSound.push(source[i]);
  } // LR interleaved

/* new method replaces getWebAudioNode.extract() */
  extractSource(outSamples, numFramesReq, frameOffset = 0){
   
    let numFramesExtracted = 0;
    if (this.sourceSound.length < numFramesReq*2) {
      numFramesExtracted = 0;
    } else { 
      outSamples.set(this.sourceSound.slice(0,numFramesReq*2));
      this.sourceSound.splice(0,numFramesReq*2);
      numFramesExtracted = numFramesReq;
    }
    return numFramesExtracted;
  }

/* Override */
  fillInputBuffer(numFrames = 0){// samples are LRLR 
    const samples = new Float32Array(numFrames * 2);
    const numFramesExtracted = this.extractSource(samples,numFrames);
    if (numFramesExtracted > 0)
      this.inputBuffer.putSamples(samples,0,numFramesExtracted);
  } 

/* inherited (called when input is end. Not used)
  onEnd() { this.callback(); }
*/


};
