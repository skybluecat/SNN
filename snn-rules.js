
let dummyRule={};

let HebbianFunc=(source,target,synapse,net)=>{
	let v1=source.getRecentFiringRate(),v2=target.getRecentFiringRate();
	return v1*v2*config.hebbianFactor-(v1+v2)*config.linearFactor-synapse.weight*config.normalizationFactor;
};

		
let HebbianRule={//note: here the rule is not simply v1v2, because when neurons are not firing there are no events. Instead, whenever stuff fires, it responds to recent firing rates, regardless of the time period between two firings, so it is not exactly the same as the classical rules. It decreases weight when the two neurons do not fire frequently together.
	useTrainingOutput:true,
	onGlobalTimeStep:(net,time)=>{
		net.updateWeights(HebbianFunc);
	},
};

let STDPFunc=(source,target,synapse)=>{return (source.trace*target.trace*10-(source.trace+target.trace)*0.01-synapse.weight*config.normalizationFactor)}

let STDPRule={
	useTrainingOutput:true,
	onFiring:(net,ev)=>{//the event only says which neuron is firing. need to test all its adjacent neurons
		let neuron=net.neurons[ev.target];
		for(let synapse of neuron.inSynapses){
			let source=net.neurons[synapse.source],target=neuron;
			let delta=STDPFunc(source,target,synapse);
			net.updateWeight(synapse,delta);
		}
		for(let synapse of neuron.outSynapses){
			let source=neuron,target=net.neurons[synapse.target];
			let delta=STDPFunc(source,target,synapse);
			net.updateWeight(synapse,delta);
		}
		
	},
};





/*

def Hebbian0(n1,n2,w,r1,r2):
    return r1*r2*1+(-w)*0.1 # regularization in case w increases until NaN

def Hebbian1(n1,n2,w,r1,r2):
    return r1*r2*1-(r1+r2)*(w+1)*0.1-max(0,w-10)*0.1 # regularization in case w increases until NaN

def Hebbian2(n1,n2,w,r1,r2): # positive weights only
    if r1>0.2 and r2>0.2: 
        return r1*r2*1-(r1+r2)*(w+1)*0.001-max(0,w-10)*0.1 # regularization in case w increases until NaN?
    return -0.01*(w-0.3)




def Hebbian3(n1,n2,w,r1,r2):
    inc=max(0,2.5-w)
    dec=max(0,w-(-2.5))
    reset=-w
    return r1*r2*1*inc-(r1*r1+r2*r2-2*r1*r2)*dec*0.2+(1-r2)*inc*0.0001 -r2*0.0001*dec #+reset*0.00001 # # (0.5-w)*0.001
    #meaning: coincidence, non-coincidence, upper bound, lower bound, natural balance, and if r2 never fires, increase weight,
    # and if r2 always fires, decrease weights
    
def Hebbian4(n1,n2,w,r1,r2): #covariance rule
    inc=max(0,2.5-w)
    dec=max(0,w-(-2.5))
    reset=-w*w*w
    avg1=n1.getAvgFiringRate()
    avg2=n2.getAvgFiringRate()
    return (r1-avg1)*(r2-avg2)*1+reset*0.005 #(1-r2)*inc*0.01 -r2*0.005*dec+

def Hebbian5(n1,n2,w,r1,r2): #use avg rate instead of currrent rate for homeostatis terms
    inc=max(0,2.5-w)
    dec=max(0,w-(-2.5))
    reset=-w*w*w
    avg1=n1.getAvgFiringRate()
    avg2=n2.getAvgFiringRate()
    return r1*r2*1*inc-(r1*r1+r2*r2-2*r1*r2)*dec*0.2+(1-avg1)*inc*0.0001 -(avg2)*0.0001*dec
    
def Hebbian6(n1,n2,w,r1,r2): #also use covariance instead of the normal hebbian term, try removing the (r1-r2)^2 term, and
    inc=max(0,2.5-w)
    dec=max(0,w-(-2.5))
    reset=-w*abs(w)
    avg1=n1.getAvgFiringRate()
    avg2=n2.getAvgFiringRate()
    return (r1-avg1)*(r2-avg2)*1-(r1-r2)*(r1-r2)*dec*0.1+(1-avg2)*inc*0.0001 -(avg2)*0.0001*dec+reset*0.0001
#tried to scale the covariance term but failed
#(min(r1,r2)*0.9+0.1)*
#math.sqrt(min(r1,r2))*

def Hebbian7(n1,n2,w,r1,r2): #a*vpre*(vpost-avg or constant)
    inc=max(0,2.5-w)
    dec=max(0,w-(-2.5))
    reset=-w*abs(w)
    avg1=n1.getAvgFiringRate()
    avg2=n2.getAvgFiringRate()
    return (r1)*(r2-0.5)*1+(1-avg2)*inc*0.0001 -(avg2)*0.0001*dec+reset*0.0001


def STDP0(n1,n2,w,r1,r2):
    inc=max(0,2.5-w)
    dec=max(0,w-(-2.5))
    reset=-w*abs(w)
    avg1=n1.getAvgFiringRate()
    avg2=n2.getAvgFiringRate()
    if (n1.isFiring() or n2.isFiring()) :
        return (n2.trace-n1.trace)*0.1
    return (1-avg2)*inc*0.01 -(avg2)*0.01*dec+reset*0.01 #0

*/