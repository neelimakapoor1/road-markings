let map;
let siteIds = [], sides = [], wheelTracks = [], lengths = [], widths = [];
let invisibleMap = {'site_id': [], 'side': [], 'wheel_track': [], 'length': [], 'width': []};
let geojsonFeatures = [];
const { Map, Data } = await google.maps.importLibrary("maps");
const {Size} = await google.maps.importLibrary("core");
const {DirectionsService} = await google.maps.importLibrary("routes");
let infowindow = new google.maps.InfoWindow();
import tokml from "./tokml.js";

const CSVFILENAME =  "data/roadmarkings.csv";
const USE_ROADS_API = false;

let measureOn = false;
let selectedFeature = null;
let bounds = new google.maps.LatLngBounds();
var directionsService = new DirectionsService();

function init(){
    loadBaseMap();
    setBounds();
    setInfoPopups();

    $.ajax({
        type: "GET",
        url: CSVFILENAME,
        dataType: "text",
        success: loadTracks
    });
}

function loadBaseMap(){
    map = new Map(document.getElementById("map"), {
        center: new google.maps.LatLng(-40.081724,176.203053),
        zoom: 12,
        mapId: "ROAD_MARKINGS",
        controlSize: 24
    });

    let measureTool = new MeasureTool(map, {
        showSegmentLength: true,
        tooltip: true,
        unit: MeasureTool.UnitTypeId.METRIC // metric, imperial, or nautical
    });

    map.addListener('contextmenu', function() {
        infowindow.close();
    });

    measureTool.addListener('measure_start', function() {
        infowindow.close();
        measureOn = true;
    });

    measureTool.addListener('measure_end', function() {
        measureOn = false;
    });
}

function setBounds(){
    map.data.addListener('addfeature', function(e) {
        let feature = e.feature;
        if (feature.getGeometry().getType() == 'LineString'){
            feature.getGeometry().forEachLatLng(function(latlng){
                bounds.extend(latlng);
            });
        }
        map.setCenter(bounds.getCenter());
        map.fitBounds(bounds);
    });
}

window.zoomToSite = function(e, siteId){
    e.stopPropagation();
    map.data.forEach(function(feature){
        if (feature.getGeometry().getType() == 'LineString' && feature.getProperty('site_id') == siteId){
            bounds = new google.maps.LatLngBounds();
            feature.getGeometry().forEachLatLng(function(latlng){
                bounds.extend(latlng);
            });
            map.setCenter(bounds.getCenter());
            map.fitBounds(bounds);
            map.setZoom(Math.min(19, map.getZoom()));
            selectedFeature = feature;
            map.data.overrideStyle(feature, {'strokeColor': 'yellow'});
            window.setTimeout(function(){
                map.data.overrideStyle(selectedFeature, {'strokeColor': getLineColor(selectedFeature.getProperty('side'))} );
                selectedFeature = null;
            }, 1000);
        }
    }); 
}

function setInfoPopups(){
    map.data.addListener('mouseover', function(event) {
        if (!measureOn && map.getZoom() > 12) {
            infowindow.close();
            var feat = event.feature;
            var html = "<b>Site_ID:</b> "+feat.getProperty('site_id')+"<br>"+
                        "<b>Side:</b> "+feat.getProperty('side')+"<br>"+
                        "<b>Wheel_Track:</b> "+feat.getProperty('wheel_track')+"<br>"+
                        "<b>Length:</b> "+feat.getProperty('length')+"<br>"+
                        "<b>Width:</b> "+feat.getProperty('width');
            infowindow.setContent(html);
            infowindow.setPosition(event.latLng);
            infowindow.setOptions({pixelOffset: new Size(0,0)});
            infowindow.open(map);
        }
     });
}

function loadTracks(text){
    let lines = text.split("\r\n");
    if (lines < 2) return null;

    let fields  = lines.shift().toLowerCase().split(',');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.length==0) continue;
        try {
            let values = line.split(',');
            let properties = {};
            for (let j = 0; j < fields.length; j++) {
                properties[fields[j]] = values[j];
            }
            properties['is_visible'] = true;

            addToArray(siteIds, properties['site_id']);
            addToArray(sides, properties['side']);
            addToArray(wheelTracks, properties['wheel_track']);
            addToArray(lengths, properties['length']);
            addToArray(widths, properties['width']);

            if ( !properties['start_lon'] || !properties['start_lat'] || !properties['stop_lon'] || !properties['stop_lat'] ){
                continue;
            }

            //Read start stop lat-lon
            var start = new google.maps.LatLng(parseFloat(properties['start_lat']), parseFloat(properties['start_lon']));
            var end = new google.maps.LatLng(parseFloat(properties['stop_lat']), parseFloat(properties['stop_lon']));

            delete properties['start_lon']; delete properties['start_lat']; delete properties['stop_lon']; delete properties['stop_lat'];
            
            //Fetch and add track along road-network
            addTrackAlongRoad(start, end, properties);

        }
        catch(e){
            console.error('Error loading track-line', line);
            console.error(e);
        }  
    }

    //Add track data to dropdowns
    addToDropdown('ddmSiteId', 'site_id', siteIds);
    addToDropdown('ddmSide', 'side', sides);
    addToDropdown('ddmWheelTrack', 'wheel_track', wheelTracks);
    addToDropdown('ddmWidth', 'width', widths, true);
    addMinMaxLengths();

    //Set track style
    map.data.setStyle(setTrackStyle);
    google.maps.event.addListener(map, 'zoom_changed', function() {
        infowindow.close();
        map.data.setStyle(setTrackStyle);
    });
}

function addTrackAlongRoad(start, stop, properties){
    if (USE_ROADS_API === true){
        //USING ROADS API -- More accurate, as it snaps origin and destination to center point of road
        //However its important to put a quota on the number of requests per day, to avoid billing
        $.get('https://roads.googleapis.com/v1/snapToRoads', {
            interpolate: true,
            key: APIKEY,
            path: (start.lat() + ',' + start.lng() + '|' + stop.lat() + ',' + stop.lng())
        }, function(result){
            let roadPoints = [];
            result.snappedPoints.forEach(roadPoint=>{
                roadPoints.push([roadPoint.location.longitude, roadPoint.location.latitude]);
            });
            displayTrack(roadPoints, properties);
        });
    }
    else {
        //USING DIRECTIONS API -- Less accurate, as doesnt snap origin and destination to center point of road
        //Create route between start and stop point
        var request = {
            origin: start,
            destination: stop,
            travelMode: 'DRIVING'
        }; 
        directionsService.route(request, function(result){
            //Get route along road
            if (!result || !result.routes || result.routes.length === 0) return;
            let roadPoints = []; //result.routes[0]['overview_path'];
            result.routes[0].legs[0].steps.forEach((step)=>{
                step.lat_lngs.forEach((latLng)=>{
                    roadPoints.push( [latLng.lng(), latLng.lat()] );
                });
            });
            displayTrack(roadPoints, properties);
        });
    }
}

function displayTrack(roadPoints, properties){
    try {
        //Get track-line
        let trackLine = turf.lineString(roadPoints, properties);

        //Add offset to track-line
        let offset = getOffsetDistance(properties);
        trackLine = getLineOffset(trackLine, offset, {units: 'meters'});
        geojsonFeatures.push(trackLine);

        //Display track
        map.data.addGeoJson(trackLine);

        //Display start point
        let startProperties = JSON.parse(JSON.stringify(properties));
        startProperties['is_start'] = true;
        let startPoint = trackLine.geometry.coordinates[0];
        map.data.add(new Data.Feature({
            geometry: new Data.Point(new google.maps.LatLng(startPoint[1], startPoint[0])),
            properties: startProperties
        }));

        //Display stop
        let stopPoint = trackLine.geometry.coordinates[trackLine.geometry.coordinates.length-1];
        map.data.add(new Data.Feature({
            geometry: new Data.Point(new google.maps.LatLng(stopPoint[1], stopPoint[0])),
            properties: properties
        }));
    }
    catch(e){
        console.error('Error in plotting site', properties['site_id']);
        console.error(e);
    }
}

function getOffsetDistance(properties){
    let distance = 0;
    if (properties['wheel_track'] == '1'){
        distance = 3.5;
    }
    else if (properties['wheel_track'] == '2'){
        distance = 1.5;
    }
    else if (properties['wheel_track'] == '3' || properties['wheel_track'] == '4'){
        distance = 0;
    }
    
    if (properties['side'] == 'Left'){
        distance = -distance;
    }
    else if (properties['side'] == 'Right'){
        distance = distance;
    }
    else {
        distance = 0;
    }
    return distance;
}

const getLineOffset = (line, distance, { units = 'kilometers' } = {}) => {
    const lineCoords = line.geometry.coordinates;

    const transformAngle = distance < 0 ? -90 : 90;
    if (distance < 0) distance = -distance;
    let offsetLines = [];
    for (let i = 0; i < lineCoords.length - 1; i++) { // Translating each segment of the line to correct position
        if (lineCoords[i][0] == lineCoords[i + 1][0] && lineCoords[i][1] == lineCoords[i + 1][1]){
            continue;
        }
        const angle = turf.bearing(lineCoords[i], lineCoords[i + 1]) + transformAngle;
        const firstPoint = turf.transformTranslate(turf.point(lineCoords[i]), distance, angle, { units })?.geometry.coordinates;
        const secondPoint = turf.transformTranslate(turf.point(lineCoords[i + 1]), distance, angle, { units })?.geometry.coordinates;
        offsetLines.push([firstPoint, secondPoint]);
    }

    let offsetCoords = [offsetLines[0][0]]; // First point inserted
    for (let i = 0; i < offsetLines.length; i++) { // For each translated segment of the initial line
        if (offsetLines[i + 1]) { // If there's another segment after this one
            const firstLine = turf.transformScale(turf.lineString(offsetLines[i]), 2); // transformScale is useful in case the two segment don't have an intersection point
            const secondLine = turf.transformScale(turf.lineString(offsetLines[i + 1]), 2); // Which happen when the resulting offset line is bigger than the initial one
            // We're calculating the intersection point between the two translated & scaled segments
            const intersect = turf.lineIntersect(firstLine, secondLine);
            if (intersect.features && intersect.features.length > 0){
                offsetCoords.push(intersect.features[0].geometry.coordinates);
            }
            else {
                offsetCoords.push(offsetLines[i][1]);
                offsetCoords.push(offsetLines[i+1][0]);
            }
        } else offsetCoords.push(offsetLines[i][1]); // If there's no other segment after this one, we simply push the last point of the line
    }

    return turf.lineString(offsetCoords, line.properties);
}

function setTrackStyle(feature){
    let side = feature.getProperty('side');
    let color = getLineColor(side);
    let isStart = feature.getProperty('is_start');
    const isPoint = feature.getGeometry().getType() === 'Point';
    if (isPoint)
        var isVisible = feature.getProperty('is_visible') && map.getZoom() > 14;
    else 
        isVisible = feature.getProperty('is_visible');

    return {
        visible: isVisible,
        strokeColor: color,
        strokeWeight: 3,
        clickable: !isPoint,
        zIndex: (isPoint? 2: 1),
        icon: {
            'url': `icons/${color}-dot.png`,
            'scaledSize': new Size(20,20),
            //'anchor': new Point(10,10)
        } //`icons/circle-fill-${color}.svg`, `icons/${color}-dot.png`,
    };
}

function getLineColor(side){
    //Blue left Green right Red center
    return (side === 'Left')? 'blue': ((side === 'Right')? 'green': 'red');
}

function addToArray(array, value) {
    value = value.trim();
    if (value != '' && array.indexOf(value) == -1){
        array.push(value);
    };
}

function addToDropdown(dropdownButtonId, fieldName, values, sortValues){
    if (sortValues) values.sort();
    for (let i=0;i<values.length;i++){
        let value = values[i];
        if (fieldName == 'site_id'){
            $('#' + dropdownButtonId).next().append(`
            <div class="form-check">
                <input class="form-check-input ms-1" type="checkbox" checked value="" 
                    onchange='onCheckFeatureValue("${fieldName}", "${value}", this.checked)';>
                <label class="link-primary link-underline form-check-label mb-1 ms-1" for="flexCheckDefault" style="text-decoration: underline;cursor: pointer" onclick="zoomToSite(event,${value})">${value}</label>
            </div>
        `);
        }
        else {
            $('#' + dropdownButtonId).next().append(`
            <div class="form-check">
                <input class="form-check-input ms-1" type="checkbox" checked value="" 
                    onchange='onCheckFeatureValue("${fieldName}", "${value}", this.checked)';>
                <label class="form-check-label mb-1 ms-1" for="flexCheckDefault">${value}</label>
            </div>
        `);
        }
    }
}

function addMinMaxLengths(){
    lengths.sort();
    if (lengths.length > 0){
        $('#minLength').val(lengths[0]);
        $('#maxLength').val(lengths[lengths.length-1]);
    }
}

window.toggleFeatureVisibility = function(){
    map.data.forEach(function(feature){
        let isVisible = true;
        for (var fieldName in invisibleMap) {
            //For each fieldName, check if value has to be invisible
            let fieldValue = feature.getProperty(fieldName);
            if (invisibleMap[fieldName].length > 0 && invisibleMap[fieldName].indexOf( fieldValue ) > -1){
                isVisible = false;
                break;
            }
        }
        feature.setProperty('is_visible', isVisible);
    }); 
}

window.onCheckFeatureValue = function(fieldName, value, isVisible){
    const index = invisibleMap[fieldName].indexOf(value);
    if (isVisible){
        //Remove from invisibility
        if (index > -1) invisibleMap[fieldName].splice(index, 1);
    }
    else {
        //Add to invisibility
        if (index == -1) invisibleMap[fieldName].push(value);
    }
    toggleFeatureVisibility(); 
}

window.searchSiteIds = function(searchStr){
    $('#ddmSiteId').next().children('.form-check').each(function () {
        const siteId = $(this).children('.form-check-label').text();
        if (siteId.indexOf(searchStr) > -1){
            $(this).show();
        }
        else {
            $(this).hide();
        }
    });
}

$("#btnShowLengths").click(function(e) {
    let minLength = min$('#minLength').val();
    let maxLength = $('#maxLength').val();
    map.data.forEach(function(feature){
        let isVisible = true;
        let length = parseFloat(feature.getProperty('length'));
        if (length < minLength || length > maxLength){
            isVisible = false;
            invisibleMap['length'].push(length);
        }
        feature.setProperty('is_visible', isVisible);
    }); 
});

$("#selectAllSites").click(function(e) {
    e.stopPropagation();
    $('#ddmSiteId').next().children('.form-check').filter(":visible").each(function () {
        $(this).children('.form-check-input').prop('checked', true);
        let value = $(this).children('.form-check-label').text();
        const index = invisibleMap['site_id'].indexOf(value);
        if (index > -1) invisibleMap['site_id'].splice(index, 1);
    });
    toggleFeatureVisibility();
});

$("#deselectAllSites").click(function(e) {
    e.stopPropagation();
    $('#ddmSiteId').next().children('.form-check').filter(":visible").each(function () {
        $(this).children('.form-check-input').prop('checked', false);
        let value = $(this).children('.form-check-label').text();
        const index = invisibleMap['site_id'].indexOf(value);
        if (index == -1) invisibleMap['site_id'].push(value);
    });
    toggleFeatureVisibility();
});

$("#btnExportToKml").click(function(e) {
    let geojson = {
        'type': 'FeatureCollection',
        'features': geojsonFeatures
    }
    const kml = tokml(geojson, {
        documentName: "Road Tracks",
        name: "road tracks",
        description: "road tracks"
    });
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(kml));
    element.setAttribute('download', 'roadtracks.kml');

    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
});


init();

