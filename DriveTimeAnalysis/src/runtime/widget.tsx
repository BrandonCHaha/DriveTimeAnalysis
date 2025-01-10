import { React, AllWidgetProps, getAppStore } from "jimu-core";
import { JimuMapViewComponent, JimuMapView } from "jimu-arcgis";
import { Button, NumericInput, Loading } from "jimu-ui";
import Graphic from "esri/Graphic";
import GraphicsLayer from "esri/layers/GraphicsLayer";
import SimpleMarkerSymbol from "esri/symbols/SimpleMarkerSymbol";
import SimpleFillSymbol from "esri/symbols/SimpleFillSymbol";
import esriRequest from "esri/request";
import IdentityManager from "esri/identity/IdentityManager";
import Polygon from "esri/geometry/Polygon";
import "./widget.css";

interface State {
  mapView: JimuMapView;
  driveTimes: number[];
  mapWidgetId: string;
  loading: boolean; // Track loading state
}

export default class Widget extends React.PureComponent<
  AllWidgetProps<unknown>,
  State
> {
  private graphicsLayer: GraphicsLayer;

  constructor(props: AllWidgetProps<unknown>) {
    super(props);
    this.state = {
      mapView: null,
      driveTimes: [5, 10, 15], // Default drive times
      mapWidgetId: this.getMapWidgetId(),
      loading: false,
    };

    this.graphicsLayer = new GraphicsLayer();
  }
  //Fetches map widget Id from experience builder
  getMapWidgetId = (): string | null => {
    const state = getAppStore().getState();
    const mapWidgets = state?.appConfig?.widgets || {};

    for (const widgetId in mapWidgets) {
      const widget = mapWidgets[widgetId];
      if (widget.manifest?.name === "arcgis-map") {
        console.log("Found map widget ID:", widgetId);
        return widgetId;
      }
    }

    console.warn("No map widget found in the app configuration.");
    return null;
  };

  getPortalUrl = (): string => {
    const state = getAppStore().getState();
    return state?.portalUrl || "https://www.arcgis.com"; // Default just in case
  };

  //Fetches token dynamically so I dont have to (and so other people can use it)
  fetchToken = async (): Promise<string> => {
    const portalUrl = this.getPortalUrl();
    try {
      const credential = await IdentityManager.getCredential(portalUrl);
      console.log("Token fetched:", credential.token);
      return credential.token;
    } catch (err) {
      console.error("Failed to fetch token:", err);
      throw new Error("Unable to fetch token.");
    }
  };

  //Initiates map view
  onMapViewCreated = (view: JimuMapView) => {
    this.setState({ mapView: view });
    view.view.map.add(this.graphicsLayer);
    console.log("Map view created and graphics layer added.");
  };

  handleMapClick = async (event: any) => {
    console.log("Map clicked at:", event.mapPoint);

    const { driveTimes } = this.state;
    const mapPoint = event.mapPoint;

    //Display Loader
    this.setState({ loading: true });

    //Shows on the map where the user has clicked
    const pointGraphic = new Graphic({
      geometry: mapPoint,
      symbol: new SimpleMarkerSymbol({
        color: "red",
        size: 10,
      }),
    });
    this.graphicsLayer.add(pointGraphic);

    //Translates mapPoint into basic lat/long for the GP service
    const facilities = `${mapPoint.longitude},${mapPoint.latitude}`;

    const gpUrl =
      "https://route.arcgis.com/arcgis/rest/services/World/ServiceAreas/NAServer/ServiceArea_World/solveServiceArea";

    try {
      const token = await this.fetchToken();

      const params = {
        facilities, //lat/long
        defaultBreaks: driveTimes.join(","),
        outSpatialReference: JSON.stringify({ wkid: 4326 }),
        f: "json",
        token,
      };

      console.log("Starting geoprocessing...");
      const response = await esriRequest(gpUrl, {
        method: "post",
        query: params,
      });

      const polygons = response.data?.saPolygons?.features || null;

      //Debugging
      if (!polygons || polygons.length === 0) {
        console.error("No polygons found in the response:", response.data);
        return;
      }

      const layerColors = [
        [0, 255, 0, 0.3], //Bottom layer: Green
        [255, 255, 0, 0.3], //Mid layer: Yellow
        [255, 0, 0, 0.3], //Top layer: Red
      ];

      polygons.forEach((polygon: any, index: number) => {
        const geometry =
          polygon.geometry.type === "polygon"
            ? polygon.geometry
            : new Polygon(polygon.geometry);

        const color = layerColors[index % layerColors.length];

        const polygonGraphic = new Graphic({
          geometry: geometry,
          symbol: new SimpleFillSymbol({
            color: color,
            outline: {
              color: "black",
              width: 1,
            },
          }),
        });
        this.graphicsLayer.add(polygonGraphic);
      });

      console.log("Geoprocessing completed successfully.");
    } catch (err) {
      console.error("Geoprocessing failed:", err);
    } finally {
      //Hide loader after polygons are displayed
      this.setState({ loading: false });
    }
  };

  clearResults = () => {
    this.graphicsLayer.removeAll();
    console.log("All graphics cleared");
  };

  updateDriveTime = (index: number, value: number) => {
    const newDriveTimes = [...this.state.driveTimes];
    newDriveTimes[index] = value;
    this.setState({ driveTimes: newDriveTimes });
    console.log(`Drive time ${index + 1} updated to:`, value);
  };

  render() {
    const { driveTimes, mapWidgetId, loading } = this.state;

    return (
      <div className="widget-drive-time">
        <div className="intro">
          Enter your 3 drive times in minutes, click start analysis, and then
          finally click the map to view drive time polygons.
        </div>
        <div>
          {driveTimes.map((time, index) => (
            <div key={index}>
              <label>Drive Time {index + 1} (minutes):</label>
              <NumericInput
                value={time}
                onChange={(value) => this.updateDriveTime(index, value)}
                min={1}
                max={15}
              />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Button
            type="primary"
            onClick={() => {
              this.state.mapView?.view.on("click", this.handleMapClick);
              console.log("Map click listener activated.");
            }}
          >
            Start Analysis
          </Button>
          <Button type="primary" onClick={this.clearResults}>
            Clear Results
          </Button>
        </div>

        {loading && (
          <div className="loader-container">
            <Loading />
          </div>
        )}

        {mapWidgetId && (
          <JimuMapViewComponent
            useMapWidgetId={mapWidgetId}
            onActiveViewChange={this.onMapViewCreated}
          />
        )}
      </div>
    );
  }
}
