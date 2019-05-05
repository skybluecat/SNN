
/*

inputFactor=1
biasInput=0 # ?? to make neurons fire when there's no positive input, should all neurons get a fixed input current?
maxFiringRate=25 # some neurons typically can only fire once per some time units
# even if LIF neurons don't really have a max firing rate, it's very tricky to train it correctly and have
# it fire almost every time step, so I think using a max firing rate to represent True may be better. 
# (and it is independent from dt)
# Also False is represented as a minimum firing rate, not no firing.
minFiringRate=5
minI=1.01 # they cause this LIF neuron to fire around min/max rates, and are used to represent True and False inputs
maxI=1.6

*/


class EventBasedNeuron{
	//this doesn't really have V at all time steps, instead it receives and emits firing events explicitly in a continuous timeframe, and although when it receives events it will calculate its new voltage (for keeping track of its internal state), and its voltage changes according to LIF formulas, in the meantime when it's not disturbed it really has no voltage data. You can observe it at any current or future moment in time, but it doesn't have a history and you cannot observe past voltages.
	
	constructor(network){
		this.network=network;
		this.v=config.initialV;
		this.trace=0;
		this.time=0;
		this.firingDelay=0.01;
		this.inSynapses=[];
		this.outSynapses=[];
		this.firingCount=0;
		this.lastFireTime=-Infinity;
		this.lastFiringTimes=new Array(config.historyLength);this.lastFiringTimes.fill(-Infinity);
		//instead of trying to actually calculate accurate average firing rates, I want to use a constant-complexity method that keeps track of the last few firing times adnd later use that to calculate the recent average firing rate. And we can also use an all-time firing count to get the all-time firing rate.
	}
	//when a neuron that has a synapse to this neuron fires, it emits an event that says this neuron will get a spike from that synapse after a certain time(assuming neurons/synapses take time). When that time comes in the global event queue, this neuron's simulate is called.
	observe(time){
		//the voltage will decrease exponentially for LIF: dv/dt=(I(t)-vm(t)/Rm)/Cm
		//if dv/dt=-k*v, vt=v0*e^-kt; currently k is 1/RC=20
		if(time==this.time)return this.v;
		let dt=time-this.time;
		this.v*=Math.pow(Math.E,-config.voltageDecay*dt);
		this.trace*=Math.pow(Math.E,-config.traceDecay*dt);
		this.time=time;
		return this.v;
	}
	simulate(time,dv){//first advance time, then add the spike voltage(currently, the input is considered instantaneous, so there's no point asking what is the I or C, instead, all input spikes add their value(reflecting weight) to V directly)
		this.observe(time);
		if(dv){
			this.v+=dv;
			if (this.v>=config.Vt){
				if(time-this.lastFireTime>=config.refractoryPeriod){
					this.v=config.Vr;
					this.trace=1;
					this.lastFireTime=time;
					this.firing=true;//means this is going to fire soon, but trace etc are not updated yet because I want to update them in one place only
					//this.sendSpike();
					//if it should fire, fire after a short delay if it was not already firing, so any remaining incoming spikes at this moment happen before its firing
					this.network.addEvent({type:FIRING,time:this.time+this.firingDelay,target:this.id});
				}
				//else keep the voltage?
			}
		}
	}
	receiveSpike(obj){
		let time=obj.time,value=obj.value;
		this.simulate(time,value);
	}
	sendSpike(ev){//emits future voltage change events depending on the outgoing connections' weights and delays
	
		for(let i=this.lastFiringTimes.length-1;i>0;i--){//shift the records
			this.lastFiringTimes[i]=this.lastFiringTimes[i-1];
		}
		this.lastFiringTimes[0]=this.time;
		this.lastFireTime=this.time;
		this.firingCount++;
		
		for(let synapse of this.outSynapses){
			let target=synapse.target;//neuron ID in the network?
			let delay=synapse.delay;
			let weight=synapse.weight;
			this.network.addEvent({type:RECEIVING,target:target,value:weight,time:this.time+delay});
		}
		this.firing=false;
	}
	getRecentFiringRate(){//we only know the time of several most recent firing events, so estimate teh firing rate by current time - earliest record of firing/firing records (or 0 if there are not any)
		let earliestFiringTime=-Infinity,count=0;
		for(let i=this.lastFiringTimes.length-1;i>=0;i--){//try from the earliest to the latest
			if(this.lastFiringTimes[i]!=-Infinity){earliestFiringTime=this.lastFiringTimes[i];count=i+1;break;}
		}
		if(count>=2)return (this.time-earliestFiringTime)/count;//if there's only one spike and it's right at this time, estimating the rate would not make sense, so just assume it's 0
		else return 0;
	}
	reset(){
		this.trace=0;
		this.v=config.initialV;
		this.time=0;
		this.firingCount=0;
		this.lastFireTime=-Infinity;
		this.lastFiringTimes.fill(-Infinity);
	}
	saveState(){
		return {v:this.v,time:this.time,trace:this.trace};
	}
	loadState(obj){
		this.v=obj.v;this.trace=obj.trace;this.time=obj.time;
	}
}

let RECEIVING=0,FIRING=1; //firing events exist because firing takes some time and we want to process all incoming spikes at this moment when one incoming spike has raised V over the threshold, so the firing is scheduled a little after the incoming spikes.
function eventComparator(a,b){
	if(a.time>b.time)return -1; 
	if(a.time<b.time) return 1; 
	if(a.type>b.type)return -1; 
	if(a.type<b.type) return 1; 
	return 0;
}
//the priority of events: receiving inputs > firing
class EventBasedNetwork{
	constructor(options){
		this.time=0;
		this.inputNeurons={};
		this.inputNeuronList=[];
		this.outputNeurons={};
		this.outputNeuronList=[];
		this.neurons={};
		this.synapses=[];
		this.eventQueue=new buckets.PriorityQueue(eventComparator);
		this.outputSpikes=[];//spikes from all output neurons
	}
	addNeuron(id){
		let n=new EventBasedNeuron(this);
		n.id=id;
		this.neurons[id]=n;
		return n;
	}
	addSynapse(s,t,weight,delay){
		let source=s,target=t;
		if(typeof source!="object")source=this.neurons[s];
		if(typeof target!="object")target=this.neurons[t];
		if(!(source&&target))throw Error();
		let sID=source.id,tID=target.id;
		
		if(weight==null)weight=Math.random()*0.4+0.3;
		if(delay==null)delay=0.05;//Math.random()*0.01+0.05;
		let synapse={weight:weight,delay:delay,source:sID,target:tID};
		this.synapses.push(synapse);
		
		source.outSynapses.push(synapse);
		target.inSynapses.push(synapse);
	}
	addInputNeuron(n){
		if(typeof n!="object")n=this.neurons[n];
		n.isInput=true;this.inputNeurons[n.id]=n;this.inputNeuronList.push(n);
	}
	addOutputNeuron(n){
		if(typeof n!="object")n=this.neurons[n];
		n.isOutput=true;this.outputNeurons[n.id]=n;n.outputIndex=this.outputNeuronList.length;this.outputNeuronList.push(n);
	}
	addLayers(inputs,outputs,hiddenLayers){
		this.layers=[];let inputlist=[],outputlist=[];
		for(let i=0;i<inputs;i++){
			let n=this.addNeuron("input"+i);
			this.addInputNeuron(n);
			inputlist.push(n);
		}
		this.layers.push(inputlist);
		if(hiddenLayers){
			let newLayer=[];
			for(let i=0;i<hiddenLayers.length;i++){
				let size=hiddenLayers[i];
				for(let j=0;j<size;j++){
					let name="layer"+i+"_"+j;
					let n=this.addNeuron(name);
					newLayer.push(n);
				}
			}
			this.layers.push(newLayer);
		}
		for(let i=0;i<outputs;i++){
			let n=this.addNeuron("output"+i);
			this.addOutputNeuron(n);
			outputlist.push(n);
		}
		this.layers.push(outputlist);
		for(let layerID=0;layerID<this.layers.length;layerID++){
			let layer=this.layers[layerID];
			if(layerID<this.layers.length-1){
				let nextLayer=this.layers[layerID+1];
				for(let source of layer){
					for(let target of nextLayer){
						this.addSynapse(source,target);
					}
				}
			}
		}
	}
	addEvent(ev){
		if(typeof ev !="object")throw Error();
		if(ev.target==undefined)throw Error();if(isNaN(ev.time))throw Error();
		this.eventQueue.add(ev);
	}
	addInputSpikes(inputs){
		for(let spike of inputs){//inputs reference input indices, not neuron IDs, need to get neuron IDs
			let targetID=this.inputNeuronList[spike.target].id;
			this.addEvent({type:FIRING,target:targetID,time:spike.time});
		}
	}
	addOutputSpikes(outputs){
		for(let spike of outputs){//forced output for training
			let targetID=this.outputNeuronList[spike.target].id;
			this.addEvent({type:FIRING,target:targetID,time:spike.time});
		}
	}
	nextTick(callbacks){//onFiring, onReceiving
		if(!callbacks)callbacks={};
		let ev=this.eventQueue.dequeue();
		let oldTime=this.time;let oldTimeStep=this.globalTimeStep;let stepSize=config.globalTimeStepSize;
		while(this.time+stepSize<ev.time){//process global time steps, up to but not including the event's time 
			this.time+=stepSize;
			for(let neuronID in this.neurons){
				this.neurons[neuronID].simulate(this.time);
			}
			if(callbacks.onGlobalTimeStep){callbacks.onGlobalTimeStep(this,this.time);}
		}
		this.time=ev.time;
		let target=this.neurons[ev.target];
		
		switch (ev.type){
			case FIRING:
				if(callbacks&&callbacks.onFiring){callbacks.onFiring(this,ev);}
				target.sendSpike(ev);
				if(ev.target in this.outputNeurons){//add the output when it leaves the queue, so the output spikes are in time order
					this.outputSpikes.push({source:target.outputIndex,time:ev.time});//it's called "source"
				}
				break;
			case RECEIVING:
				if(callbacks&&callbacks.onReceiving){callbacks.onReceiving(this,ev);}
				target.receiveSpike(ev);
				if(config.debug)console.log(ev.target+ " received spike of value "+ev.value+" at time "+ev.time+", now its voltage is "+target.v);
				break;
			default:throw Error("unknown event type "+ev.type);
		}
	}
	runUntilDone(inputSpikes,callbacks){//onStart, onEnd
		//returns all output spike events, when there are no more spikes in the system
		//supposes that teh queue and the output spike list was empty
		if(!callbacks)callbacks={};
		this.addInputSpikes(inputSpikes);
		if(callbacks.trainingOutputSpikes){this.addOutputSpikes(callbacks.trainingOutputSpikes);}//set by the training, because this code doesn't know the expected output here
		if(callbacks&&callbacks.onStart){callbacks.onStart(this);}//can be used to add forced output
		while(!this.eventQueue.isEmpty()){
			this.nextTick(callbacks);//for local spike-based updates like STDP
		}
		if(callbacks&&callbacks.onEnd){callbacks.onEnd(this);}//can be used to do error-based training
		return this.outputSpikes;
	}
	resetState(){//keep the topology ad weights but reset spikes and voltages
		this.eventQueue=new buckets.PriorityQueue(eventComparator);
		this.outputSpikes=[];
		for(let id in this.neurons){
			this.neurons[id].reset();
		}
	}
	saveState(){
		//only saves neuron voltages and spikes in the queue etc, not the topology and weights right now.
		//used to test the output given some input, without changing teh current weights etc.
		let neuronStates={};
		for(let id in this.neurons){
			neuronStates[id]=this.neurons[id].saveState();
		}
		return {neuronStates:neuronStates,eventQueue:this.eventQueue,outputSpikes:this.outputSpikes,time:this.time}
	}
	loadState(obj){
		for(let id in this.neurons){
			this.neurons[id].loadState(obj.neuronStates[id]);
		}
		this.eventQueue=obj.eventQueue;this.outputSpikes=obj.outputSpikes;this.time=obj.time;
	}
	runTestInputs(inputs){
		let state=this.saveState();
		this.resetState();
		let output=this.runUntilDone(inputs);
		this.loadState(state);
		return output;
	}
	updateWeight(synapse,delta){//one synapse
		synapse.weight+=delta*config.learningRate;
	}
	updateWeights(ruleFunc){
		for(let sID in this.neurons){
			let source=this.neurons[sID];
			for(let synapse of source.outSynapses){
				let target=this.neurons[synapse.target];
				let delta=ruleFunc(source,target,synapse,this);
				this.updateWeight(synapse,delta);
			}
		}
	}
	
	//allow getting events as a generator? events include firing and receiving spikes
	setEncoder(encoder,index){this.inputNeuronList[index].encoder=encoder;}
	setEncoders(encoders){
		if(Array.isArray(encoders)){for(let i=0;i<encoders.length;i++){this.setEncoder(encoders[i],i);}}
		else{for(let i=0;i<this.inputNeuronList.length;i++){this.setEncoder(encoders,i);}}
	}
	setDecoder(decoder,index){this.outputNeuronList[index].decoder=decoder;}
	setDecoders(decoders){
		if(Array.isArray(decoders)){for(let i=0;i<decoders.length;i++){this.setDecoder(decoders[i],i);}}
		else{for(let i=0;i<this.outputNeuronList.length;i++){this.setDecoder(decoders,i);}}
	}
	setOutputEncoder(encoder,index){this.outputNeuronList[index].encoder=encoder;}
	setOutputEncoders(encoders){
		if(Array.isArray(encoders)){for(let i=0;i<encoders.length;i++){this.setOutputEncoder(encoders[i],i);}}
		else{for(let i=0;i<this.outputNeuronList.length;i++){this.setOutputEncoder(encoders,i);}}
	}
	encode(inputs,delay){
		let spikes=[];
		for(let i=0;i<inputs.length;i++){
			let value=inputs[i];
			let encoder=this.inputNeuronList[i].encoder;
			let temp=encoder(value);
			for(let spike of temp){spike.target=i;if(delay)spike.time+=delay;}//need to add target information here

			spikes=spikes.concat(temp);
		}
		return spikes;
	}
	encodeOutput(outputs,delay){
		let spikes=[];
		for(let i=0;i<outputs.length;i++){
			let value=outputs[i];
			let encoder=this.outputNeuronList[i].encoder;
			let temp=encoder(value);
			for(let spike of temp){spike.target=i;if(delay)spike.time+=delay;}//need to add target information here
			spikes=spikes.concat(temp);
		}
		return spikes;
	}
	decode(spikes){
		let neuronSpikes=[];for(let i=0;i<this.outputNeuronList.length;i++){neuronSpikes[i]=[];}
		for(let spike of spikes){//note: output spikes are also referenced by output index, but it's called source rather than target
			neuronSpikes[spike.source].push(spike);
		}
		let results=[];
		for(let i=0;i<this.outputNeuronList.length;i++){
			results[i]=this.outputNeuronList[i].decoder(neuronSpikes[i]);
		}
		return results;
	}
}

//training needs to provide I/O encoding and decoding, real-time visual output and testing (to see how well training is going and whether there are test cases whose outputs don't seem to be improved by training - to be able to stop training early and not waste time)
//also training rules: 

class EventBasedTraining{
	constructor(net,func,learningRule,sampler,lossFunc){
		//net is a network or a description of multilayer network shape like [2,[2],1]
		//func is a function from unencoded logical inputs (ie numbers or booleans, not spikes) to desired unencoded outputs; I/O are arrays and are applied to the list of inputs and outputs.
		//sampler is a function that returns a random possible input. basic samplers can uniformly sample boolean or (some range of) integers or floats, or teh user can define others.
		//encoder/decoder transforms spikes from/to logical input. Now all inputs/outputs can use teh same encoder/decoder.
		//should encoder/decoder be decided when building the network or adding inputs/outputs? I don't see how having a network with multiple sets of encoder/decoder helps. however, it is essential that the user can have access to input/output spikes and not just logical values.(for debugging/visualization for example) But then, the network may be better left as just a network and leave encoding to other parts of teh code. Plus, the user may what to test different encoding parameters as well, so it shouldn't be a part of the network?
		//
		this.net=net;this.targetFunc=func;this.learningRule=learningRule;this.sampler=sampler;this.lossFunc=lossFunc;
		//this.encoder=encoder;this.decoder=decoder;
		//learningRule.encoder=this.encoder;learningRule.decoder=this.decoder;//some rules may need them
		
	}
	trainInput(inputs){//one set of inputs and outputs; the rule can listen to different events like firing or receiving, or at the end
		let inputSpikes=this.net.encode(inputs);let expectedOutputs=this.targetFunc.apply(null,inputs);if(Array.isArray(expectedOutputs)==false)expectedOutputs=[expectedOutputs];
		if(this.learningRule.useTrainingOutput){
			this.learningRule.trainingOutputSpikes=this.net.encodeOutput(expectedOutputs,config.trainingOutputDelay);
		}
		this.net.runUntilDone(inputSpikes,this.learningRule);//for learning rules that need training inputs, it should add firing or input events to output neurons in its onStart callback. The delay if needed is also defined in the learning rule. If it needs an encoder (in case of training inputs) or a decoder (for back propagation type rules), 
	}
	train(episodes,callback){
		//use the global config for learning rates, for interactivity
		//after each episode, the network should be reset and there would not be any need for delay between episodes; also, the learning weight changes must defined per episode instead of per time step (and in fact we don't truly have per time-step learning since we don't have time steps) so average firing rate etc have to be managed by the rule itself, and even that is limited to single episodes.
		//and so there's no time window in an episode to apply learning rules on, and no time window defined here to apply rate-encoded inputs; instead, the length of inputs is part of the encoder's work.

		if(episodes==undefined){
			if(this.sampler.type=="boolean")episodes=Math.pow(2,Object.keys(this.net.inputs).length)*10;
			else episodes=100;
		}
		for(let e=0;e<episodes;e++){
			let inputs=this.sampler();
			this.trainInput(inputs);
			if(callback)callback();
		}
	}
	testInput(inputs){
		//this test will not affect the state
		let inputSpikes=this.net.encode(inputs);
		let outputSpikes=this.net.runTestInputs(inputSpikes);
		let outputs=this.net.decode(outputSpikes);
		//let expectedOutputs=this.func(inputs);
		return outputs;//{outputs:outputs,expectedOutputs:expectedOutputs};
		//note: for training, boolean functions shold be converted to use float values to be able to see the error changing. so the outputs here are always numerical.
	}
	test(episodes,diagnose=false){
		//this test is randomized; if we need to cover all discrete cases (like booleans), explicitly test all cases
		if(episodes==undefined){
			if(this.sampler.type=="boolean")episodes=Math.pow(2,Object.keys(this.net.inputs).length)*10;
			else episodes=100;
		}
		let sumLoss=0;
		for(let e=0;e<episodes;e++){
			let inputs=this.sampler();
			let expectedOutputs=this.targetFunc.apply(null,inputs);
			if(Array.isArray(expectedOutputs)==false)expectedOutputs=[expectedOutputs];
			let outputs=this.testInput(inputs);
			//if(callback)callback();
			let loss=this.lossFunc(outputs,expectedOutputs);
			sumLoss+=loss;
			if(diagnose){console.log("Inputs: "+inputs.join(",")+", outputs: "+outputs.join(",")+", expected: "+expectedOutputs.join(",")+", loss: "+loss);}
		}
		return sumLoss/episodes;
	}
}

function randomBoolean(){if(Math.random()>0.5)return true;return false;}
function random01(){if(Math.random()>0.5)return 1;return 0;}
function arrayEqual(a,b){if(a.length!=b.length)return false;for(let i=0;i<a.length;i++){if(a[i]!=b[i])return false;}return true;}
function maxAbsoluteError(a,b){
	let max=0;
	for(let i=0;i<a.length;i++){
		let error=Math.abs(a[i]-b[i]);
		if(error>max)max=error;
	}
	return max;
}

function clamp(x,min,max){
	return Math.min(max,Math.max(x,min));
}

function BooleanSampler(numInputs){//returns a function that returns a uniformly sampled boolean array
	return ()=>{
		let array=[];
		for(let i=0;i<numInputs;i++){array.push(random01());}//use numbers instead
		return array;
	}
}

function booleanRateEncoder(value){
	let spikes=[];
	let rate;
	if(value){rate=config.highRate;}
	else{rate=config.lowRate;}
	if(rate!=0){
		let interval=1/rate;
		for(let time=0;time<config.timeLength;time+=interval){
			spikes.push({time:time});
		}
	}
	return spikes;
}

function booleanRateDecoder(spikes){
	let max=config.highRate*config.timeLength,min=config.lowRate*config.timeLength;
	return clamp((spikes.length-min)/max,0,1);
}




function allBooleanInputs(numInputs){
	if(numInputs==1)return [[true],[false]];
	let smaller=allBooleanInputs(numInputs-1);
	let arr=[];
	for(input of smaller){arr.push(input.concat(true));arr.push(input.concat(false));}
	return arr;
}


