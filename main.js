window.addEventListener('load', function() {
	init();
});

var net,training;

let OR=(a,b)=>{if(a||b)return [1];return [0];};
let AND=(a,b)=>{if(a&&b)return [1];return [0];};

config.learningRules={Hebbian:HebbianRule,STDP:STDPRule};
config.learningRule="Hebbian";
function init(){
	initControls();
	getE("debug-run-button").onclick=()=>{
		try {debugRun();}catch(e){getE("debug-output-area").textContent=e.message;}
	};
	
	net=new EventBasedNetwork();
	net.addLayers(2,1,[3]);
	net.setEncoders(booleanRateEncoder);
	net.setOutputEncoders(booleanRateEncoder);
	net.setDecoders(booleanRateDecoder);

	//let learningRule=HebbianRule;
	//let learningRule=STDPRule;
	let sampler=BooleanSampler(2);
	training=new EventBasedTraining(net,AND,HebbianRule,sampler,maxAbsoluteError);
	gui.__folders.Training.add(config,"learningRule",["Hebbian","STDP"]).onChange((value)=>training.learningRule=config.learningRules[value]);
	setInterval(trainAndTest,1000);
}   


let allInputs=allBooleanInputs(2);let trainingCount=0;


function trainAndTest(){
	if(!config.running)return;
	let batchsize=Math.floor(config.trainingBatchSize);
	training.train(batchsize);
	trainingCount+=batchsize;
	
	let networkStr="";
	networkStr+="trained episodes: "+trainingCount+"\n";
	getE("network-info-area").innerText=networkStr;

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
	
	
	let testResults=[];
	for(let inputs of allInputs){
		let expectedOutputs=training.targetFunc.apply(null,inputs);
		let outputs=training.testInput(inputs);
		let loss=training.lossFunc(outputs,expectedOutputs);
		let firingCounts="";for(let neuronID in this.net.neurons){firingCounts+=neuronID+": "+this.net.neurons[neuronID].firingCount+", ";}
		testResults.push({inputs:inputs,outputs:outputs,expectedOutputs:expectedOutputs,loss:loss,firingCounts:firingCounts});
	}
	let testRows={Inputs:x=>x.inputs.join(","),Outputs:x=>x.outputs.join(","),Expected:x=>x.expectedOutputs.join(","),loss:x=>shortStr(x.loss), "firing counts":x=>x.firingCounts};
	showTable(selectE("tests-table"),testResults,testRows);
}

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

let shortStr=d3.format(" .5");
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