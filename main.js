window.addEventListener('load', function() {
	init();
});

var net,training;

let OR=(a,b)=>{if(a||b)return [1];return [0];};
let AND=(a,b)=>{if(a&&b)return [1];return [0];};

function init(){
	initControls();
	
	net=new EventBasedNetwork();
	net.addLayers(2,1);
	net.setEncoders(booleanRateEncoder);
	net.setOutputEncoders(booleanRateEncoder);
	net.setDecoders(booleanRateDecoder);

	let learningRule=HebbianRule;
	//let learningRule=STDPRule;
	let sampler=BooleanSampler(2);
	training=new EventBasedTraining(net,AND,learningRule,sampler,maxAbsoluteError);;
	setInterval(trainAndTest,1000);
}   


let allInputs=allBooleanInputs(2);let trainingCount=0;
function trainAndTest(){
	if(!config.running)return;
	let batchsize=Math.floor(config.trainingBatchSize);
	training.train(batchsize);
	let weightsStr="";
	for(let synapse of net.synapses){
		weightsStr+="Source: "+synapse.source+", target: "+synapse.target+", weight: "+synapse.weight+"\n";
	}
	getE("network-info-area").innerText=weightsStr;
	
	trainingCount+=batchsize;
	let str="";str+="trained episodes: "+trainingCount+"\n";
	for(let inputs of allInputs){
		let expectedOutputs=training.targetFunc.apply(null,inputs);
		let outputs=training.testInput(inputs);
		let loss=training.lossFunc(outputs,expectedOutputs);
		let firingCounts="Firing counts: ";for(let neuronID in this.net.neurons){firingCounts+=neuronID+": "+this.net.neurons[neuronID].firingCount+", ";}
		str+="Inputs: "+inputs.join(",")+", outputs: "+outputs.join(",")+", expected: "+expectedOutputs.join(",")+", loss: "+loss+" "+firingCounts+"\n"
	}
	getE("test-output-area").innerText=str;
}

function getE(str){return document.getElementById(str);}