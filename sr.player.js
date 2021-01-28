/*
* @module sverigesradio
* @author x7dude
* @description Provides content from sverigesradio.se
*/

module.exports=function exportSverigesRadioPlayer(scope,settings){

    const BetterLog=scope.BetterLog
    // const BetterEvents=scope.BetterEvents
    const cX=scope.BetterUtil.cX
    const httpX=scope.BetterUtil.httpX
    const ffprobe=scope.api.apps['q-ffprobe'].ffprobe
    const ffmpeg=scope.api.apps['q-ffmpeg'].source
    const cheerio=scope.cheerio;


	const stations={
		'sverigesradio:p1':'https://live-cdn.sr.se/pool2/p1/p1.isml/p1-audio=192000.m3u8'
		,'sverigesradio:p2':'https://live-cdn.sr.se/pool2/p2/p2.isml/p2-audio=192000.m3u8'
		,'sverigesradio:p3':'https://live-cdn.sr.se/pool1/p3/p3.isml/p3-audio=192000.m3u8'
		,'sverigesradio:p4':'https://live-cdn.sr.se/pool3/p4stockholm/p4stockholm.isml/p4stockholm-audio=48000.m3u8'
	}

	const digilistan='https://sverigesradio.se/sida/topplista.aspx?programid=2697'

	//All you need to do is append the numerical id to this string. It will return a json with the contents url
	const cdn='https://sverigesradio.se/playerajax/getaudiourl?type=clip&quality=high&format=iis&id='



	

	function SverigesRadioPlayer(){
		
		Object.defineProperty(this,'log',{value:new BetterLog(this)});	


		/*
		* @const object cdnTracks 	SR has a cdn that allows listening to tracks on their website. When we come across these 
		*							(eg. when scraping digilistan) we store them here so we can later come back and get their
		*							full info/stream. Keys are `sverigesradio:${id}`, values are objects with the info found together
		*							with the id
		*/
		const cdnTracks={};


		/*
		* @const object root 	The root folder
		*/
		const root={
			uri:'sverigesradio:/'
			,title:'Sveriges Radio'
			,type:'folder'
			,contents:Object.keys(stations).concat(['sverigesradio:digilistan'])
		}






		/*
		* Check if something is a SR uri
		*
		* @param string uri
		*
		* @return Promise(bool,EFAULT) 	Resolves with true if we can play this uri, else false. If the target is lost forever
		*								we reject.
		*/
		this.canPlayUri=async function canPlayUri(uri){
			try{
				cX.checkType('string',uri);
				var m=uri.match(/^sverigesradio:(.+)$/)
				if(m){
					if(root.contents.includes(uri)||uri==root.uri||cdnTrack[uri])
						return true;

					//The only remaining option is that it's a track that we havn't got through a list... so just check
					let n=Number(m[1]);
					if(n){
						//First check the tracks we already know, then check online
						await getCdnTrackInfo(n) //throws if doesn't exist
						return true;
					}	
				}
				//If we're still running that means the uri didn't match anything we know about... but perhaps another
				//app that also deals with sveriges radio might be able to play it, so just return false
				return false;

			}catch(err){
				return this.log.makeError(err).somewhere(uri).setCode('EFAULT').reject();
			}
		}






		/*
		* Get information about a uri
		*
		* @param string uri
		* 
		* @return Promise(object,<ble TypeError|ESEQ>)
		*/
		this.getUriDetails=async function getUriDetails(uri){
			try{
				
				//A slightly crude implementation, but at present we don't have that many items, so we just check...
				if(uri==root.uri)
					return root
				else if(uri=='sverigesradio:digilistan')
					return getDigilistan();
				else if(root.contents.includes(uri)){
					return getStationDetails(uri);
				}else{
					return getCdnTrackInfo(uri.slice(14)).then(addProbeInfo);
				}

			}catch(err){
				if(err && err.code && err.code=='TypeError')
					return err.reject()
				
				if(typeof uri!='string'){
					this.log.error(err);
					return this.log.makeTypeError('string',uri).reject();
				}

				return this.log.makeError(err).addHandling('call canPlayUri() before getUriDetails()').setCode('ESEQ').reject();
			}
		}





		/*
		* @method getStream 	
		*
		* @param object track 	@see getUriDetails()
		*
		* @return <Readable>
		*/
		this.getStream=function(track){
			if(!track || typeof track !='object' || !track.uri)
				self.log.throwType("track object",track);

			this.log.traceFunc(arguments);

			//Make sure to get a track from this player (seems in other situations not doing this, if there's an error, said error
			//takes a long time to track down)
			this.canPlayUri(track.uri);

			var child=ffmpeg(track.contents,'wav',this.log);
			  //^the input format 'hls' won't work here, so use wav instead
			  //TODO 2020-06-04: is this the case for digilistan too??

			return child.stdout;
		//TODO 2020-07-07: do we want to return the child (so it can be stopped) or just he stream? do we want to attach sort of stopping
		//					mechanism on the stream?
		}



		/*
		* Probe a content stream for format details, adding it to a details object in progress
		* @param object details 		An object with at least property 'contents' which is a string url to the stream
		* @return Promise($details) 	The live object is appended AND resovled
		*/
		function addProbeInfo(details){
			return ffprobe(details.contents,5000).then((info)=>{//5000=>longer timeout since we're fetching remote...
				//add format info and return 
				return Object.assign(details,info);
			});
		}


		/*
		* Get details about a station
		* @param string uri
		* @return object 		An object with type=='radio'
		*/
		function getStationDetails(uri){
			var station={
				uri:uri
				,type:'radio'
				,contents:stations[uri]
				,title:'Sveriges Radio '+uri.split(':')[1].toUpperCase()
			}
			return addProbeInfo(station);
		}



/*
Digilistan

Scrape the page for and get the row items... there you can get the artist/title + the id of the song
Get all <li> in the list:
	document.querySelectorAll('article.music-toplist li.track')


The first call get's the url we need
	https://sverigesradio.se/playerajax/getaudiourl?id=7273377&type=clip&quality=high&format=iis
returns:
	https://lyssna-cdn.sr.se/isidor/ereg/webb_rh_sthlm/2020/02/47_move_-_the_mamas_359267a_a192.m4a
which you can listen to straight in the browser

Then u run:
	/opt/ffmpeg_ssl/bin/ffmpeg -i https://lyssna-cdn.sr.se/isidor/ereg/webb_rh_sthlm/2020/02/47_move_-_the_mamas_359267a_a192.m4a -vn -f alsa default


*/

		/*
		* @return Promise(objet) 	Resolves with a playlist object
		*/
		function getDigilistan(){
			//The show airs sundays between 12:00-14:30, unsure when the list is published but between 11:30-15:00 
			//we expire the list every 10 minutes which means the main library will call this function again
			//if a client asks again during that time
			let now=cX.BetterDate()
			if(now.dow==0 && now.copy().set.time('11:30')<now && now.copy().set.time('15:00')>now){
				now.add.minutes(10);
			}else{
				now.goto.upcoming('sunday').set.time('11:30');
			}

			//Start building the object we'll return
			var playlist={
				uri:'sverigesradio:digilistan'
				,type:'playlist'
				,title:'Digilistan'
				,validTo:now.unix()
				,contents:[]
			}

			//Then we need the contents, so grab the page which we'll then scrape for tracks, and when it's
			//all said and done we return the promise
			return util.httpX.get(digilistan,{_onlyContents:true})
				.then(html=>{
					//...then scrape it for all tracks
					var contents=[];
					var $=cheerio.load(html);
					$('article.music-toplist li.track').each(function digilistan(i){
						try{
							let li=$(this)
							let info={type:'track'};
							let name=li.find('span.track-title, span.track__title').first().text();
							if(name){
								let arr=name.split(' - ');
								info.artist=arr[0];
								info.title=arr[1];
							}

							var uri;
							let id=Number(li.find('.track__play > a').attr('data-audio-id'));
							if(id){
								uri=info.uri='sverigesradio:'+id;
								//Store the id for later fetching
								cdnTracks[id]=info
								
							}else{
								uri=`_search:${encodeURIComponent(info.artist+' '+info.title)}`
							}
							//NOTE: we store to the library when we have the full data, not before, that's why we have to the
							//command twice^. On the other hand, the uri can be added to the list before all the details are in v
							contents.push(uri);

						}catch(err){
							log.error('Failed to process item '+i,err);
						}
					});
				})
			;
		}











		/*
		* Check if the SR CDN contains a given id
		*
		* NOTE: This does NOT probe the stream... which should be done seperately because it takes extra time
		* 
		* @param number id 		An id set on the <a> node that launches the web player
		*
		* @return Promise(object,<ble>) 	Resolves with {duration,contents}
		*/
		function getCdnTrackInfo(id){
			//If we already have all the info, just return it
			if(cdnTracks.hasOwnProperty(id) && cdnTracks[id].contents)
				return Promise.resolve(cdnTracks[id]);

			if(typeof id!='number')
				return log.rejectType('number id',id);
			
			return util.httpX.get(cdn+id,{_followRedirects:2, _onlyContents:true})
				.then(
					info=>{
						//Combine with existing info (and change the name of one prop) and store
						info=cdnTracks[id]=Object.assign({duration:info.duration, contents:info.audioUrl},cdnTracks[id],);
						
						//If no title has been set that's because this track has not popped up as part of a list, in 
						//which case we try to guess it from the contents
						if(!info.title){
							let m=info.contents.match(/\/\d+_(.+)_-_(.+)_[a-f0-9]{7}/);
							if(m){
								info.title=m[1].replace('_',' '); //TODO: capitalize first letters
								info.artist=m[2].replace('_',' ');
							}
						}

						//Finally just make sure it has the uri set
						info.uri='sverigesradio:'+id;

						return info;
					err=>log.makeError("SR CDN does not have id "+id,err).reject()
				})

			;
		}
	}



	return new SverigesRadioPlayer();


}


