import { useEffect, useRef, useState } from 'react';
import { Viewer, Cartesian3, Color, ArcType, createWorldTerrainAsync, Ion } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// TODO: Replace with your actual Cesium Ion access token
// It's recommended to use an environment variable for this
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

interface FlightDataPoint {
  latitude?: number;
  longitude?: number;
  altitude?: number;
}

interface Props {
  flightData: FlightDataPoint[];
  altitudeOffset: number;
}

const MapDisplay3D = ({ flightData, altitudeOffset }: Props) => {
  const cesiumContainer = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [isViewerInitialized, setIsViewerInitialized] = useState(false);

  // Effect for initializing and destroying the viewer
  useEffect(() => {
    const initViewer = async () => {
      if (cesiumContainer.current) {
        const terrainProvider = await createWorldTerrainAsync();
        viewerRef.current = new Viewer(cesiumContainer.current, {
          terrainProvider: terrainProvider,
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          baseLayerPicker: false,
          navigationHelpButton: false,
        });
        setIsViewerInitialized(true);
      }
    };
    initViewer();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      setIsViewerInitialized(false);
    };
  }, []); // Empty dependency array, runs only once on mount

  // Effect for updating the flight path
  useEffect(() => {
    if (isViewerInitialized && viewerRef.current && flightData.length > 0) {
      const viewer = viewerRef.current;
      viewer.entities.removeAll();

      const flightPath = flightData
        .filter(d => d.latitude != null && d.longitude != null && d.altitude != null)
        .flatMap(d => [d.longitude!, d.latitude!, d.altitude! + altitudeOffset]);

      if (flightPath.length > 0) {
        const pathEntity = viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights(flightPath),
            width: 5,
            material: Color.RED,
            arcType: ArcType.NONE,
          },
        });
        viewer.flyTo(pathEntity);
      }
    }
  }, [isViewerInitialized, flightData, altitudeOffset]); // Re-run when data or offset changes

  return <div ref={cesiumContainer} style={{ width: '100%', height: '100%' }} />;
};

export default MapDisplay3D;