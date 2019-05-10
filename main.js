window.addEventListener('load', function() {
	init();
});

var net,model,training;



config.learningRules={Hebbian:HebbianRule,STDP:STDPRule};
config.learningRule="Hebbian";
function init(){
	initControls();
	getE("debug-run-button").onclick=()=>{
		try {debugRun();}catch(e){getE("debug-output-area").textContent=e.message;}
	};
	
	

	 //the movement model
	
	net=new EventBasedNetwork();
	net.addLayers(2,1,[3]);
	net.setAdapters(BooleanRateAdapter);//for all inputs and outputs
	net.learningRule=HebbianRule;
	
	model=new EventBasedModel();
	model.addNetwork(net);
	model.addVariable("targetPosition",0);
	model.addVariable("position",0);
	model.addVariable("velocity",0);
	model.addLink("targetPosition",net.neurons.input0); //the link is from an input (neuron or variable name) to an output
	model.addLink("position",net.neurons.input1);
	model.addLink(net.neurons.output0,"velocity");
	model.setSimulationFunc((v,dt)=>{v.position+=v.velocity*dt;});
	model.setInputs("targetPosition");//model input/outputs are variables
	model.setOutputs("position");

	let hints={velocity:(v)=>(v.targetPosition-v.position)};
	//now expected outputs and sampler of inputs use variable/neuron names, and are no longer array-based
	let lossFunc=(i,o)=>{
		return Math.abs(o.position-i.targetPosition);
	}
	
	let sampler={targetPosition:FloatRangeSampler(0,1),position:FloatRangeSampler(0,1),velocity:0};
	training=new EventBasedTraining(model,hints,sampler,lossFunc);
	
	

	
	/* //the AND/OR network
	
	let OR=(a,b)=>{if(a||b)return 1;return 0;};
	let AND=(a,b)=>{if(a&&b)return 1;return 0;};
	
	net=new EventBasedNetwork();
	net.addLayers(2,1);
	net.setAdapters(BooleanRateAdapter);//for all inputs and outputs
	net.learningRule=HebbianRule;
	
	let hints={output0:(v)=>(AND(v.input0,v.input1))};
	//now expected outputs and sampler of inputs use variable/neuron names, and are no longer array-based
	let lossFunc=(i,o)=>{return Math.abs(o.output0-AND(i.input0,i.input1));}
	
	let sampler={input0:BooleanSampler(),input1:BooleanSampler()};
	training=new EventBasedTraining(net,hints,sampler,lossFunc);
	*/
	
	gui.__folders.Training.add(config,"learningRule",["Hebbian","STDP"]).onChange((value)=>net.learningRule=config.learningRules[value]);
	gui.__folders.Training.add(net,"resetWeights");
	setInterval(trainAndTest,1000);
	
	onTopologyUpdated();
}   


//let allInputs=allBooleanInputsByName("input0,input1");
let allInputs=[{targetPosition:0,position:0,velocity:0},{targetPosition:1,position:0,velocity:0},{targetPosition:0.5,position:0,velocity:0}];//allBooleanInputs(2);
let trainingCount=0;

function allBooleanInputsByName(names){
	if(typeof names=="string")names=names.split(",");
	if(names.length==1){
		let name=names[0];
		let a={},b={};a[name]=0;b[name]=1;
		return [a,b];
	}
	let smaller=allBooleanInputsByName(names.slice(1));
	let arr=[];
	let name=names[0];
	for(input of smaller){
		let obj1={};Object.assign(obj1,input);obj1[name]=0;arr.push(obj1);
		let obj2={};Object.assign(obj2,input);obj2[name]=1;arr.push(obj2);
	}
	return arr;
}

function trainAndTest(){
	if(!config.running)return;
	let batchsize=Math.floor(config.trainingBatchSize);
	training.train(batchsize);
	trainingCount+=batchsize;
	
	let networkStr="";
	networkStr+="trained episodes: "+trainingCount+"\n";
	getE("network-info-area").innerText=networkStr;
/*
	let inSynapseSummary=(list)=>{
		if(list.length==0)return "None";
		return list.map((x)=>x.source+": "+shortStr(x.weight)).join(", ");
	}
	let outSynapseSummary=(list)=>{
		if(list.length==0)return "None";
		return list.map((x)=>x.target+": "+shortStr(x.weight)).join(", ");
	}
	let rows={"neuron ID":(neuron)=>neuron.id,inputs:(neuron)=>inSynapseSummary(neuron.inSynapses),outputs:(neuron)=>outSynapseSummary(neuron.outSynapses)};
	showTable(selectE("network-table"),net.neurons,rows);
*/
	
	let testResults=[];
	for(let inputs of allInputs){
		//let expectedOutputs={};for(let name in training.targetFuncs){expectedOutputs[name]=training.targetFuncs[name](inputs);}
		let outputs=training.testInput(inputs);
		let loss=training.lossFunc(inputs,outputs);
		let firingCounts="";for(let neuronID in this.net.neurons){firingCounts+=neuronID+": "+this.net.neurons[neuronID].firingCount+", ";}
		testResults.push({inputs:inputs,outputs:outputs,loss:loss,firingCounts:firingCounts});//expectedOutputs:expectedOutputs,
	}
	let testRows={Inputs:x=>toStr(x.inputs),Outputs:x=>toStr(x.outputs),loss:x=>shortStr(x.loss), "firing counts":x=>x.firingCounts};
	//Expected:x=>toStr(x.expectedOutputs),
	showTable(selectE("tests-table"),testResults,testRows);
	
	onWeightsUpdated();
	
}

function toStr(obj){if(Array.isArray(obj))return obj.join(",");return Object.keys(obj).map((key)=>key+": "+shortStr(obj[key])).join(", ");}

function debugRun(){
	let inputStr=getE("debug-input").value;
	let inputs=inputStr.split(",").map((x)=>x.trim());
	if(inputs[inputs.length-1].length==0)inputs.pop();
	inputs=inputs.map((x)=>{
		if(x.toLowerCase()=="true")return 1;
		if(x.toLowerCase()=="false")return 0;
		if(isNaN(x)){throw Error("invalid input value \""+x+"\"");return 0;} //should warn
		return Number(x);
	});
	if(inputs.length!=net.inputNeuronList.length)throw Error("wrong number of inputs: expected "+net.inputNeuronList.length+", got "+inputs.length);
	
	let expectedOutputs=training.targetFunc.apply(null,inputs);
	let outputs=training.testInput(inputs);
	let loss=training.lossFunc(outputs,expectedOutputs);
	
	let resultStr="Inputs: "+inputs.join(",")+", outputs: "+outputs.join(",")+", expected: "+expectedOutputs.join(",")+", loss: "+loss+"\n"
	
	getE("debug-output-area").textContent=resultStr;
	
}

function onWeightsUpdated(){//refresh the diagram's styles and entries in the table
	refreshTraining();
}

function onTopologyUpdated(){
	//recreate the diagram, tables, test inputs(?) etc
	drawTraining(training,selectE("training-info-area"));
}

function showNeuron(neuron){
	console.log(neuron.id);
}

function spaceEvenly(count,index,itemSize,width,maxGap){
	if(count==1)return width/2;
	let realWidth=width-2*itemSize;if(maxGap){realWidth=Math.min(maxGap*(count-1),realWidth);}
	let offset=(width-realWidth)/2;
	return realWidth*index/(count-1)+offset;
}

function drawNetwork(net,containerSelection){
	
	let width=600,height=400,maxGap=180,nodeSize=15,xOffset=0,yOffset=0;
	
	let nodesView;
	if(containerSelection.node().nodeName=="g"){
		let rect=containerSelection.node();
		nodesView=containerSelection;width=Number(containerSelection.attr("width"));height=Number(containerSelection.attr("height"));xOffset=Number(containerSelection.attr("x"));yOffset=Number(containerSelection.attr("y"));
	}
	else{nodesView=containerSelection.append("svg").attr("width",width).attr("height",height);}
	nodesView.selectAll("g").remove();
	if(net.layers){
		/*let layersView=containerSelection.append("div").attr("class","network-layers").style("display","flex").style("flex-flow","row");
		let layersSelection=layersView.selectAll("div").data(net.layers).enter().append("div").style("display","flex").style("flex-flow","column");
		layersSelection.selectAll("button").data((d)=>d).enter().append("button").text((d)=>d.id).on("click",showNeuron);*/
		let layerCount=net.layers.length;
		for(let i=0;i<net.layers.length;i++){
			let layer=net.layers[i];
			let x=spaceEvenly(layerCount,i,nodeSize+20,width,maxGap);
			let neuronCount=layer.length;
			for(let j=0;j<layer.length;j++){
				let neuron=layer[j];
				let y=spaceEvenly(neuronCount,j,nodeSize+20,height,maxGap);
				neuron.x=x+xOffset;neuron.y=y+yOffset;
			}
		}
		
		let linkLabelPos=0.2;
		
		let linksSelection=nodesView.append("g").attr("class", "links").selectAll("line").data(net.synapses).enter().append("line").attr("x1",(d)=>net.neurons[d.source].x).attr("y1",(d)=>net.neurons[d.source].y).attr("x2",(d)=>net.neurons[d.target].x).attr("y2",(d)=>net.neurons[d.target].y).style("stroke", "grey").style("stroke-width", "2px");
		
		let nodesSelection=nodesView.append("g").attr("class", "nodes").style("z-index",1).selectAll("circle").data(Object.values(net.neurons)).enter().append("circle").attr("cx",(d)=>d.x).attr("cy",(d)=>d.y).attr("r", nodeSize).style("fill", "white").style("stroke", "black").style("stroke-width", "2px").on("click",showNeuron);
		let labelsSelection=nodesView.append("g").attr("class", "labels").selectAll("text").data(Object.values(net.neurons)).enter().append("text").attr("x",(d)=>d.x-20).attr("y",(d)=>d.y+30).text((d)=>d.id).style("fill", "black");
		
		let linkLabelsSelection=nodesView.append("g").attr("class", "labels").selectAll("text").data(net.synapses).enter().append("text").attr("x",(d)=>net.neurons[d.source].x*(1-linkLabelPos)+net.neurons[d.target].x*linkLabelPos).attr("y",(d)=>net.neurons[d.source].y*(1-linkLabelPos)+net.neurons[d.target].y*linkLabelPos-10).style("fill", "black").text((d)=>shortStr(d.weight));
		
		net.nodesSelection=nodesSelection;net.linksSelection=linksSelection;net.linkLabelsSelection=linkLabelsSelection;
	}
	
	else{
		//do layout?
	}
	
}

function refreshNetwork(net){
	net.linksSelection.style("stroke-width", (d)=>clamp(d.weight+1,0.5,10)+"px");
	net.linkLabelsSelection.text((d)=>shortStr(d.weight));;
}
function showVariable(v){console.log(v);}
function drawModel(model,containerSelection){
	let width=600,height=400,maxGap=180,nodeSize=15;
	let shapesSelection=containerSelection.append("svg").attr("width",width).attr("height",height);
	let count=model.nets.length;
	let netsSelection=shapesSelection.selectAll("g").data(model.nets).enter().append("g").attr("x",nodeSize*3).attr("y",(d,index)=>width*index/count).attr("width",width-nodeSize*6).attr("height",height/count).each(function(d,index){//we need the "this" DOM element here
		drawNetwork(d,d3.select(this));
	});
	
	let variableCount=Object.values(model.variables).length;let i=0;
	for(let name in model.variables){let variable=model.variables[name];variable.y=spaceEvenly(variableCount,i,nodeSize+20,height,maxGap);i++;}
	
	let variableLinksSelection=shapesSelection.append("g").attr("class", "links").selectAll("line").data(model.links).enter().append("line").attr("x1",(d)=>{if(typeof d.source=="string")return nodeSize+2;else return d.source.x;}).attr("y1",(d)=>{if(typeof d.source=="string")return model.variables[d.source].y;else return d.source.y;}).attr("x2",(d)=>{if(typeof d.target=="string")return width-nodeSize-2;else return d.target.x;}).attr("y2",(d)=>{if(typeof d.target=="string")return model.variables[d.target].y;else return d.target.y;}).style("stroke", "grey").style("stroke-width", "2px");
	
	let inputVariablesSelection=shapesSelection.append("g").attr("class", "nodes").selectAll("circle").data(Object.values(model.variables)).enter().append("circle").attr("cy",(d,index)=>d.y).attr("cx",nodeSize+2).attr("r", nodeSize).style("fill", "white").style("stroke", "black").style("stroke-width", "2px").on("click",showVariable);
	let inputVariablesLabelSelection=shapesSelection.append("g").attr("class", "labels").selectAll("text").data(Object.values(model.variables)).enter().append("text").text((d)=>d.id).attr("y",(d,index)=>d.y+25).attr("x",10).style("fill", "black");
	
	let outputVariablesSelection=shapesSelection.append("g").attr("class", "nodes").selectAll("circle").data(Object.values(model.variables)).enter().append("circle").attr("cy",(d,index)=>d.y).attr("cx",width-nodeSize-2).attr("r", nodeSize).style("fill", "white").style("stroke", "black").style("stroke-width", "2px").on("click",showVariable);
	let outputVariablesLabelSelection=shapesSelection.append("g").attr("class", "labels").selectAll("text").data(Object.values(model.variables)).enter().append("text").text((d)=>d.id).attr("y",(d,index)=>d.y+25).attr("x",width-70).style("fill", "black");
	
	
	
	//for now we don't worry about where to put each network - they are all at the cenetr
	
}
function refreshModel(model){
	for(let net of model.nets){refreshNetwork(net);}
	
}

function drawTraining(training,containerSelection){
	containerSelection.selectAll("*").remove();
	let obj=training.net;
	let netSelection=containerSelection.append("div");
	if(obj instanceof EventBasedNetwork){
		netSelection.attr("class","network");
		drawNetwork(obj,netSelection);
	}
	else{
		netSelection.attr("class","model");
		drawModel(obj,netSelection);
	}
	let funcSelection=containerSelection.append("textarea").style("width","90%").text("functions for injected output values");
	let buttonSelection=containerSelection.append("button").text("update target functions").on("click",()=>{training.targetFuncs=eval(funcSelection.node().value);});
}
function refreshTraining(){
	let obj=training.net;
	if(obj instanceof EventBasedNetwork){
		refreshNetwork(obj);
	}
	else{
		refreshModel(obj);
	}
}










//utilities

let shortStr=d3.format(" .3");
//function shortStr(value){return String(value).substring(0,6);}

function getE(str){return document.getElementById(str);}
function selectE(str){return d3.select(document.getElementById(str));}


function showTable(tableSelection,dataObj,rowMaps,rowOnclick,cellOnclick){
	let array=[];	
	if(Array.isArray(dataObj)){//only get normal array entries
		for(let index=0;index<dataObj.length;index++){
			let res={index:index};
			for(let row in rowMaps){
				res[row]=rowMaps[row](dataObj[index],index);
			}
			array.push(res);
		}
	}
	else{
		for(let index in dataObj){
			let res={index:index};
			for(let row in rowMaps){
				res[row]=rowMaps[row](dataObj[index],index);
			}
			array.push(res);
		}
	}
	
	
	array.sort(compareBy((x)=>Number(x.index)));
	//console.log(array);
	let columns=Object.keys(rowMaps);//todo: add CC count etc
	let table=tableSelection;//tableContainerSelection.select("table");
	let thead = table.select('thead')
	
	let ttitle = thead.select('tr.title');
	let tcolumns = thead.select('tr.columns');
	tcolumns.selectAll('th').remove();
	tcolumns=tcolumns.selectAll('th')
		.data(columns);
	tcolumns.exit().remove();
	tcolumns.enter().append('th').text(function (column) { return column; });
	
	let	tbody = table.select('tbody');
	tbody.selectAll("tr").remove();//todo: fix the not-updating table
	tbody=tbody.selectAll("tr").data(array);
	tbody.exit().remove();
	tbody=tbody.enter().append("tr");
	if(rowOnclick){tbody.on("click",rowOnclick);}
	
	let grid=tbody.selectAll('td');
	grid=grid.data(function (row) {
			return columns.map(function (column) {
			  return {column: column, value: row[column],rowIndex:row.index,rowObj:row};
			});
		  });
	grid.exit().remove();
	grid=grid.enter().append('td').text(function (d) { return (d.value!==undefined)?d.value:""; });
	if(cellOnclick){grid.on("click",cellOnclick);}
}



function compareBy(f,bigFirst) {
	if(typeof f!="function"){
		let p=f;
		f=(x)=>x[p];
	}
	if(bigFirst){
		return function(a,b){
			let fa=f(a),fb=f(b);
			if (fa < fb)
				return -1;
			if (fa > fb)
				return 1;
			return 0;
		}
	}
	else{
		
		return function(a,b){
			let fa=f(a),fb=f(b);
			if (fa > fb)
				return -1;
			if (fa < fb)
				return 1;
			return 0;
		}
	
	}
}