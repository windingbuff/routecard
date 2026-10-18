import { field, table, column, view, metric, item, csvArtifact, summary } from './lib/product-kit.mjs';
export const product = {
  category:'Delivery operations',projectNoun:'Delivery plan',runLabel:'Build dispatch plan',
  outcome:'Maintain stops and a directed travel matrix, compare route scenarios and export a driver dispatch sheet.',
  fields:[table('stops','Delivery stops',[column('id','Stop ID'),column('service','Service minutes','number'),column('demand','Capacity units','number'),column('window','Window start / end (minutes)','range')]),
    field('matrix','Travel time matrix (minutes)','matrix',{help:'Every direction is explicit. Update the stop list before filling new rows and columns.'}),field('start','Departure minute (480 = 08:00)','number'),field('capacity','Vehicle capacity','number'),field('lockedPrefix','Stops fixed at the beginning','list')],
  describe(result) {
    return summary([metric('Served stops',result.order.length),metric('Unserved',result.unserved.length),metric('Vehicle load',result.replay.load),metric('Return minute',result.replay.returnTime)],[
      view('Driver dispatch sheet',[column('id','Stop'),column('arrival','Arrival minute'),column('start','Service start'),column('finish','Service end'),column('wait','Wait minutes')],result.replay.completed),
      view('Unserved stops',[column('id','Stop'),column('reason','Reason')],result.unserved),
    ],[...result.replay.completed.map(s=>item(`stop:${s.id}`,`Review stop ${s.id}`,`Arrival ${s.arrival}; service ${s.start}–${s.finish}`)),...result.unserved.map(s=>item(`unserved:${s.id}`,`Unserved ${s.id}`,s.reason,true))],{type:'route',stops:result.replay.completed,returnTime:result.replay.returnTime});
  },
  artifacts(result) {
    return [csvArtifact('dispatch','Driver dispatch sheet',[column('id','Stop'),column('arrival','Arrival minute'),column('start','Service start'),column('finish','Service end'),column('wait','Wait minutes')],result.replay.completed),csvArtifact('unserved','Unserved stops',[column('id','Stop'),column('reason','Reason')],result.unserved)];
  },
};
