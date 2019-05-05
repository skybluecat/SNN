
var config={
	//neurons
	dt:0.01,
	traceDecay:0.95,
	refractoryPeriod:0.01,
	
	initialV:0.1,
	voltageDecay:20,
	Vt:0.5,
	Vr:0.1,
	R:0.5,
	C:0.1,
	
	historyLength:5,
	
	//network and training
	globalTimeStepSize:0.1,//will advance time, keeping all neurons more or less in sync, and trigger "time passing" events even if no other events are happening to some neurons
	timeLength:10,
	trainingOutputDelay:0.1,
	highRate:1,
	lowRate:0.1,
	
	//training
	running:true,
	trainingBatchSize:100,
	trainingInterval:1000,
	
	learningRate:0.1,
	hebbianFactor:0.1,
	linearFactor:0.01,
	normalizationFactor:0.01,
	STDPFactor:0.01,
	
	
};
var gui;
function initControls(){
	gui=new dat.GUI({autoPlace:false});
	getE("controls-area").appendChild(gui.domElement);
	gui.domElement.style.width="";
	var neuronFolder = gui.addFolder('Neuron');
	neuronFolder.add(config,"traceDecay",0.9,0.999);
	neuronFolder.add(config,"refractoryPeriod",0.001,0.1);
	neuronFolder.add(config,"initialV",-1,1);
	neuronFolder.add(config,"voltageDecay",1,50);
	neuronFolder.add(config,"Vt",0.1,1);
	neuronFolder.add(config,"Vr",-0.5,0.5);
	neuronFolder.add(config,"historyLength",2,10);
	
	
	var networkFolder = gui.addFolder('Network');
	networkFolder.add(config,"globalTimeStepSize",0.01,0.5);
	networkFolder.add(config,"timeLength",2,50);
	networkFolder.add(config,"trainingOutputDelay",2,50);
	networkFolder.add(config,"highRate",5,100);
	networkFolder.add(config,"lowRate",0.1,5);
	
	var trainingFolder = gui.addFolder('Training');
	trainingFolder.add(config,"running");
	trainingFolder.add(config,"learningRate",0.01,1);
	trainingFolder.add(config,"trainingBatchSize",1,1000);
	trainingFolder.add(config,"hebbianFactor",0.01,0.5);
	trainingFolder.add(config,"linearFactor",0,0.5);
	trainingFolder.add(config,"normalizationFactor",0.001,0.1);
	trainingFolder.add(config,"STDPFactor",0.001,0.1);
}