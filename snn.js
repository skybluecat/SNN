
class EventBasedNeuron{
	//this doesn't really have V at all time steps, instead it receives and emits firing events explicitly in a continuous timeframe, and although when it receives events it will calculate its new voltage (for keeping track of its internal state), and its voltage changes according to LIF formulas, in the meantime when it's not disturbed it really has no voltage data. You can observe it at any current or future moment in time, but it doesn't have a history and you cannot observe past voltages.
	
	constructor(net){
		this.net=net;
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
					this.firing=true;//if it should fire, fire after a short delay if it was not already firing, so any remaining incoming spikes at this moment happen before its firing
					this.net.addEvent({type:FIRING,time:this.time+this.firingDelay,target:this.id});
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
		//if this spike is encoded, we assume that it's undesirable to have any more non-injected spikes, so decrease the voltage.
		if(ev.exclusive){this.v=config.exclusiveSpikePenalty;}
		
		for(let synapse of this.outSynapses){
			let target=synapse.target;//neuron ID in the network?
			let delay=synapse.delay;
			let weight=synapse.weight;
			this.net.addEvent({type:RECEIVING,target:target,value:weight,time:this.time+delay});
		}
		this.firing=false;
	}
	getRecentFiringRate(){//we only know the time of several most recent firing events, so estimate the firing rate by average interval, or current interval if it's larger than the average interval
		let earliestFiringTime=-Infinity,count=0;
		for(let i=this.lastFiringTimes.length-1;i>=0;i--){//try from the earliest to the latest
			if(this.lastFiringTimes[i]!=-Infinity){earliestFiringTime=this.lastFiringTimes[i];count=i+1;break;}
		}
		if(count>=2){
			let avgTime=(this.lastFireTime-earliestFiringTime)/(count-1),interval=avgTime;
			if(this.time-this.lastFireTime>avgTime){interval=this.time-this.lastFireTime;}//the rate should be smooth for stable firing no matter when it's sampled, but should start dropping immediately when a spike comes later than expected
			return 1/interval;
		}
		else return 0;//if there's only one spike, estimating the rate would not make sense, so just assume it's 0
	}
	encode(value,untilTime){
		return this.adapter.encode(value,untilTime);
	}
	decode(){
		return this.adapter.decode();
	}
	reset(){
		this.trace=0;
		this.v=config.initialV;
		this.time=0;
		this.firingCount=0;
		this.lastFireTime=-Infinity;
		this.lastFiringTimes.fill(-Infinity);
		if(this.adapter){this.adapter.reset();}
	}
	save(){//save adapter state too
		let obj={v:this.v,time:this.time,trace:this.trace};if(this.adapter){obj.adapter=this.adapter.save();}
		return obj;
	}
	load(obj){
		this.v=obj.v;this.trace=obj.trace;this.time=obj.time;if(this.adapter){this.adapter.load(obj.adapter);}
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
		this.time=0;this.globalTimeStep=0;
		this.inputs={};
		this.inputList=[];
		this.outputs={};
		this.outputList=[];
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
		n.isInput=true;this.inputs[n.id]=n;this.inputList.push(n);
	}
	addOutputNeuron(n){
		if(typeof n!="object")n=this.neurons[n];
		n.isOutput=true;this.outputs[n.id]=n;n.outputIndex=this.outputList.length;this.outputList.push(n);
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
	setAdapters(adapterClass){
		for(let neuron of this.inputList){neuron.adapter=new adapterClass(neuron);}
		for(let neuron of this.outputList){neuron.adapter=new adapterClass(neuron);}
	}
	setLearningRule(rule){this.learningRule=rule;}
	resetWeights(){
		for(let synapse of this.synapses){synapse.weight=Math.random()*0.4+0.3;}
	}
	addEvent(ev){
		if(typeof ev !="object")throw Error();
		if(ev.target==undefined)throw Error();if(isNaN(ev.time))throw Error();
		this.eventQueue.add(ev);
	}

	nextTick(training=false){//now the network has the learning rule as a proeprty, and doesn't use callbacks here
		let ev=this.eventQueue.dequeue();let rule=this.learningRule;
		let oldTime=this.time;let oldTimeStep=this.globalTimeStep;let stepSize=config.globalTimeStepSize;
		while(this.globalTimeStep+stepSize<ev.time){//process global time steps, up to but not including the event's time - even if nexttick is called very often, global steps still happen on its own pace
			this.globalTimeStep+=stepSize;this.time=this.globalTimeStep;
			for(let neuronID in this.neurons){
				this.neurons[neuronID].simulate(this.time);
			}
			if(training&&rule.onGlobalTimeStep){rule.onGlobalTimeStep(this,this.time);}
		}
		this.time=ev.time;
		let target=this.neurons[ev.target];
		
		switch (ev.type){
			case FIRING:
				if(training&&rule.onFiring){rule.onFiring(this,ev);}
				target.sendSpike(ev);
				//now the output is directly decoded from recent history, and dynamic output should be captured by the user code
				/*if(ev.target in this.outputNeurons){//add the output when it leaves the queue, so the output spikes are in time order
					this.outputSpikes.push({source:target.outputIndex,time:ev.time});//it's called "source"
				}*/
				break;
			case RECEIVING:
				if(training&&rule.onReceiving){rule.onReceiving(this,ev);}
				target.receiveSpike(ev);
				if(config.debug)console.log(ev.target+ " received spike of value "+ev.value+" at time "+ev.time+", now its voltage is "+target.v);
				break;
			default:throw Error("unknown event type "+ev.type);
		}
	}
	runUntil(time,isTraining){
		
		while((!this.eventQueue.isEmpty())&&(this.eventQueue.peek().time<=time)){//don't go beyond that time
			this.nextTick(isTraining);//for local spike-based updates like STDP
		}
		//advance to that moment
		for(let neuronID in this.neurons){
			this.neurons[neuronID].simulate(time);
		}
		//when this is called (for incremental running), the input adapters' time should have already advanced to the current time, so don't have to advance their time.
	}

	runInputs(inputs,trainingOutputs){//runs for the whole timeLength; only works for static inputs and expected outputs (dynamic stuff must use a model) since the network runs continuously but I don't see how to accurately encode it. (Maybe the encoder can numerically do it with more steps, if the value is a function) but anyway this does not support output-input feedback, only predefined inputs
		//returns an object with output values (using neuron names)
		this.reset();
		for(let neuronID in this.inputs){
			if(neuronID in inputs){this.inputs[neuronID].encode(inputs[neuronID]);}//until TimeLength by default
		}
		//trainingOutputs can be functions but are only evaluated once in the beginning
		//if there are no training spikes, training outputs have no effect on nets, unlike models
		if(trainingOutputs&&this.learningRule.useTrainingOutput){//even if the learning rule doesn't inject training outputs, it may still be used for error-based learning (or you can pass in true if there's no expected output)
			let spikes;//debug
			for(let neuronID in this.outputs){
				let value=trainingOutputs[neuronID];
				if(typeof value=="function"){value=value(inputs);}
				if(neuronID in trainingOutputs){
					spikes=this.outputs[neuronID].encode(value);
				}
			}
		}
		while(!this.eventQueue.isEmpty()&&(this.eventQueue.peek().time<=config.timeLength)){//+config.outputDelay?
			this.nextTick(trainingOutputs);//for local spike-based updates like STDP
		}
		return this.decodeOutputs();
	}
	decodeOutputs(){
		let outputs={};
		for(let neuronID in this.outputs){
			outputs[neuronID]=this.outputs[neuronID].decode();
		}
		return outputs;
	}
	reset(){//keep the topology ad weights but reset spikes and voltages
		this.time=0;this.globalTimeStep=0;
		this.eventQueue=new buckets.PriorityQueue(eventComparator);
		this.outputSpikes=[];
		for(let id in this.neurons){
			this.neurons[id].reset();
			if(this.neurons[id].adapter)this.neurons[id].adapter.reset();
		}
	}
	save(){//also save adapter states?
		//only saves neuron voltages and spikes in the queue etc, not the topology and weights right now.
		//used to test the output given some input, without changing the current weights etc.
		let neuronStates={};
		for(let id in this.neurons){
			neuronStates[id]=this.neurons[id].save();
		}
		return {neuronStates:neuronStates,eventQueue:this.eventQueue,outputSpikes:this.outputSpikes,time:this.time}
	}
	load(obj){
		for(let id in this.neurons){
			this.neurons[id].load(obj.neuronStates[id]);
		}
		this.eventQueue=obj.eventQueue;this.outputSpikes=obj.outputSpikes;this.time=obj.time;
	}
	runTestInputs(inputs){
		let state=this.save();
		//this.reset();
		let output=this.runInputs(inputs);
		this.load(state);
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

}


class EventBasedModel{//the model wraps the network along with other aspects of the simulation, into something that can be simulated in time steps and can directly take logical inputs and give useful outputs. 
	constructor	(net){
		this.nets=[];if(net)this.addNetwork(net);
		this.variables={};this.links=[];
		this.variableValues={};
		this.inputs={};this.inputList=[];this.outputs={};this.outputList=[];
		this.time=0;
	}
	addNetwork(net){this.nets.push(net);}
	addVariable(name,value,options){
		//range? 
		this.variables[name]={id:name,value:value,source:null,target:null};//for now a variable only connects to one neuron?
		this.variableValues[name]=value;
		this.encodersForNeurons={};
	}
	addLink(source,target){
		this.links.push({source:source,target:target});
		if(typeof source=="string"){this.variables[source].target=target;target.inputVariable=source;}//a neuron - normally one variablel only has one target?
		if(typeof target=="string"){this.variables[target].source=source;source.outputVariable=target;}//a neuron
	}
	addInput(name){this.inputs[name]=this.variables[name];this.inputList.push(this.variables[name]);}
	addOutput(name){this.outputs[name]=this.variables[name];this.outputList.push(this.variables[name]);}
	setInputs(inputs){//mark some variables as inputs
		if(typeof inputs=="string")inputs=inputs.split(",");
		for(let name of inputs){if(name in this.variables==false)throw Error();this.addInput(name);}
	}
	setOutputs(outputs){//mark some variables as inputs
		if(typeof outputs=="string")outputs=outputs.split(",");
		for(let name of outputs){if(name in this.variables==false)throw Error();this.addOutput(name);}
	}
	setSimulationFunc(f){
		if(typeof f=="string")f=eval(f);
		this.simulationFunc=f;
	}
	resetWeights(){for(let net of this.nets) net.resetWeights();}
	
	setVariable(name,value){
		if(name in this.variables==false)throw Error();
		if(typeof value=="function")value=value(this.variableValues,this.time);
		if(value===undefined||Number.isNaN(value))throw Error();
		this.variables[name].value=value;
		this.variableValues[name]=value;
	}
	setVariables(variables){
		for(let name in this.variables){
			if(name in variables==false)continue;
			this.setVariable(name,variables[name]);
		}
	}
	
	nextStep(inputs,trainingOutputs){

		let stepSize=config.modelStepSize,nextStepTime=this.time+stepSize;
		if(inputs){//dynamic input
			this.setVariables(inputs);
		}
		//collect training values - they may be shared by networks. Now they will be set, whether or not nets use them. (for evaluating the loss, don't use the expected output, but use the loss function)
		if(trainingOutputs){this.setVariables(trainingOutputs);}
		
		for(let net of this.nets){
			//one network's output can only affect otehr networks in the next step, so encode and run networks before decoding all networks
			for(let neuronID in net.inputs){
				//the network's inputs may be different from the model's inputs
				let neuron=net.inputs[neuronID];
				let name=neuron.inputVariable;//should set if available
				let value=this.variables[name].value;
				neuron.encode(value,nextStepTime);//until next step
			}
			//forced output needs to be handled here: set and encode. For loss-based training, the running of the model is no different from testing, so no expected output needs to be present?
			//trainingOutputs, like inputs, is an object
			if((trainingOutputs)&&net.learningRule.useTrainingOutput){//if there's no training output when it's requested (like in testing), it won't encode them
				for(let neuronID in net.outputs){
					let neuron=net.outputs[neuronID];
					let name=neuron.outputVariable;//should set if available
					let value;
					if(name in trainingOutputs)value=this.variableValues[name];
					else throw Error("missing training output "+name);
					neuron.encode(value,nextStepTime);//until next step
				}
			}
			
			net.runUntil(nextStepTime,trainingOutputs);//note: if training inputs are used, add them before running the network.
			
			//if it uses forced output, set the dynamic desired output if available, instead of the neuron's outputs, to avoid error buildup; but if there's no training output (loss-based training) then don't do it
		}
		//one network's output can only affect otehr networks in the next step, so encode and run networks before decoding all networks
		//after all nets are run, decode teh outputs, except tose that are in the forces training outputs
		for(let net of this.nets){
			for(let neuronID in net.outputs){
				let neuron=net.outputs[neuronID];
				let name=neuron.outputVariable;//should set if available
				if(!name)throw Error("missing training output "+name);
				let value;
				if((!trainingOutputs)||(name in trainingOutputs==false)){
					value=neuron.decode();this.setVariable(name,value);
				}
			}
		}
			
		//simulate one step; the way the simulate fuction is written, assumes there's one object that contains these values
		for(let name in this.variables){this.variableValues[name]=this.variables[name].value;}
		this.simulationFunc(this.variableValues,stepSize);
		for(let name in this.variables){this.variables[name].value=this.variableValues[name];}
		
		this.time=nextStepTime;
	}
	reset(){
		this.time=0;
		for(let net of this.nets){net.reset();}
	}
	//unlike networks that may run until spikes are exhausted, models must run for a predefined time period
	runInputs(inputs,trainingOutputs){//the same training and testing API as networks, but networks can run in continuous time but models only run in steps. hints can be functions that are evaluated every step, for dynamic training inputs (eg motion) - networks also have hints but they are static (the difference between expected outputs and hints is not just whetehr it's in the model's output, but also when they are evaluated - expected outputs depend on the sampled input and don't change in time, but hints can change in time
		//this runs from time 0. 
		this.reset();
		while(this.time<config.timeLength){
			this.nextStep(inputs,trainingOutputs);
		}
		return this.variableValues;
	}
	runTestInputs(inputs){
		//let state=this.save();
		this.reset();
		let output=this.runInputs(inputs);
		//this.load(state);
		return output;
	}
}

class EventBasedTraining{
	constructor(net,funcs,samplers,lossFunc,hints){//net cam also be a model - they behave similarily
		this.net=net;this.targetFuncs=funcs;this.samplers=samplers;this.lossFunc=lossFunc;this.hints=hints;
		//samplers is a map of functions, or even constant values?
		//hints is an optional map of dynamic training outputs, evaluated at every step for models (nets don't ahve steps so they evaluate once only). funcs (expected outputs) are static and only evaluated once for one run.
	}
	getSample(){
		if(typeof this.samplers=="function")return this.samplers();
		let inputs={};
		for(let name in this.samplers){
			let sampler=this.samplers[name];let value=sampler;if(typeof value=="function")value=value();inputs[name]=value;
		}
		return inputs;
	}
	trainInput(inputs){//now training doesn't do encoding
		//this.net.outputs or model.outputs is the map of real outputs; otehr things in func may be training hints??
		//note:pass the target functions. the model uses them dynamically but networks use them statically
		//need to reset (for time etc)
		let outputs=this.net.runInputs(inputs,this.targetFuncs);
		let loss=this.lossFunc(inputs,outputs);
		//for simplicity, return the inputs, outputs, and loss (now there are no explicit expected outputs)
		return {inputs:inputs,outputs:outputs,loss:loss};
	}
	train(episodes,callback){
		//after each episode, the network should be reset and there would not be any need for delay between episodes; also average firing rate etc is limited to single episodes. 
		if(episodes==undefined){
			/*let episodes=1;
			let inputCount=Object.keys(this.samplers).length;
			for(let name in this.samplers){
				let sampler=this.samplers[name];
				if(typeof sampler!="function")continue;
				if(sampler.isBoolean)episodes*=2;else episodes*=10;
			}*/
			episodes=100;
		}
		for(let e=0;e<episodes;e++){
			let inputs=this.getSample();
			
			this.trainInput(inputs);
			if(callback)callback();
		}
	}
	testInput(inputs){//this test will not affect the state
		let outputs=this.net.runTestInputs(inputs);
		//let expectedOutputs=this.func(inputs);
		return outputs;//{outputs:outputs,expectedOutputs:expectedOutputs};
		//note: for training, boolean functions shold be converted to use float values to be able to see the error changing. so the outputs here are always numerical.
	}
	test(episodes,diagnose=false){
		//this test is randomized; if we need to cover all discrete cases (like booleans), explicitly test all cases
		if(episodes==undefined){
			//if(this.sampler.type=="boolean")episodes=Math.pow(2,Object.keys(this.net.inputs).length)*10;
			//else episodes=100;
			episodes=100;
		}
		let sumLoss=0;
		for(let e=0;e<episodes;e++){
			let inputs=this.getSample();
			let outputs=this.testInput(inputs);
			let loss=this.lossFunc(input,outputs);
			sumLoss+=loss;
			if(diagnose){console.log("Inputs: "+inputs.join(",")+", outputs: "+outputs.join(",")+", loss: "+loss);}
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

function BooleanSampler(){
	return random01;
}

function BooleanArraySampler(numInputs){//returns a function that returns a uniformly sampled boolean array
	return ()=>{
		let array=[];
		for(let i=0;i<numInputs;i++){array.push(random01());}//use numbers instead
		return array;
	}
}

function FloatRangeSampler(min,max){//returns a function that returns a uniformly sampled float
	return ()=>{
		return Math.random()*(max-min)+min;
	}
}


class BooleanRateAdapter {//should it just inject/receive spikes directly with the network? it's stateful and has its own time
	constructor(neuron){ //it attaches to the neuron, but not to the model variable? should it be a part of the network?
		this.value=0;this.potential=0;this.time=0;this.neuron=neuron;this.net=neuron.net;this.neuronID=neuron.id;
	}
	save(){return {value:this.value,potential:this.potential,time:this.time};}
	load(obj){this.value=obj.value;this.potential=obj.potential;this.time=obj.time}
	reset(){
		this.value=0;this.potential=0;this.time=0;
	}
	//it caches its own value. (this one's value is actually 0-1, but otehr kinds of adapters may work for non numerical values. Also no one said it can only work on one neuron...
	//note: all encode/decode are based on current values, and encode has a time limit - get spikes for how long
	encode(value,untilTime){//a delay without spikes can be added by just changing this.time
		let spikes=[];
		let rate;//let value=this.value;
		rate=clamp(value,0,1)*(config.highRate-config.lowRate)+config.lowRate;
		if(untilTime==undefined)untilTime=config.timeLength+config.outputDelay;
		let timeLength=untilTime-this.time;
		if(rate!=0){
			let interval=1/rate;let totalPotential=timeLength*rate;//how many spikes it's "worth"
			while (totalPotential+this.potential>=1){
				let waitTime=(1-this.potential)*interval;let spikeTime=waitTime+this.time;
				let ev={type:FIRING,target:this.neuronID,time:spikeTime,exclusive:true};
				if(this.net)this.net.addEvent(ev);spikes.push(ev);
				totalPotential-=(1-this.potential);this.potential=0;
				this.time+=waitTime;
			}
			this.potential+=totalPotential;//remaining "partial spike"
			this.time=untilTime;
		}
		else{
			this.time=untilTime;
		}
		return spikes;
	}
	
	decode(){//use the history of the neuron, not necessarily all output spikes. rate encoding is best decoded by taking the average interval of available recent history spikes, and if the current period without spikes is longer than that average, use 1/the current period without spikes (this ensures smoothness no matter when it's sampled, right after a spike or before a spike)
		let max=config.highRate,min=config.lowRate;
		//use the same rate calculation as the neuron's
		let rate=this.net.neurons[this.neuronID].getRecentFiringRate();
		
		return clamp((rate-min)/(max-min),0,1);
	}
}


function allBooleanInputs(numInputs){
	if(numInputs==1)return [[true],[false]];
	let smaller=allBooleanInputs(numInputs-1);
	let arr=[];
	for(input of smaller){arr.push(input.concat(true));arr.push(input.concat(false));}
	return arr;
}


