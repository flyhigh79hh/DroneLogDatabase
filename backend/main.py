from fastapi import FastAPI, HTTPException, Depends, File, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey, Date, Float, DateTime, func, Table, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship, joinedload
from pydantic import BaseModel
from typing import List, Optional
from starlette.responses import Response
import json
import io
import traceback
import os
import csv
from datetime import datetime, date
import glob
import math
import gpxpy
import gpxpy.gpx
import simplekml
from fastapi.exceptions import RequestValidationError
from starlette.background import BackgroundTask
from starlette.responses import JSONResponse, FileResponse
from starlette.status import HTTP_422_UNPROCESSABLE_ENTITY
import uuid

# Database Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dronelogger.db")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

flight_battery_packs = Table('flight_battery_packs', Base.metadata,
    Column('flight_id', Integer, ForeignKey('flights.id'), primary_key=True),
    Column('battery_pack_id', Integer, ForeignKey('battery_packs.id'), primary_key=True)
)

# Haversine formula to calculate distance between two lat/lon points in meters
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000  # Radius of Earth in meters

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    distance = R * c
    return distance

def calculate_robust_duration(flight_data: List['FlightData']) -> float:
    """Calculates flight duration filtering out statistical outliers."""
    if not flight_data or len(flight_data) < 2:
        return 0.0

    timestamps = sorted([dp.timestamp for dp in flight_data if dp.timestamp])
    
    if not timestamps or len(timestamps) < 2:
        return 0.0

    epoch_timestamps = [ts.timestamp() for ts in timestamps]

    n = len(epoch_timestamps)
    if n < 4: # Not enough data for IQR method, return simple duration
        return epoch_timestamps[-1] - epoch_timestamps[0]

    # IQR method to filter outliers
    q1_index = int(n * 0.25)
    q3_index = int(n * 0.75)
    q1 = epoch_timestamps[q1_index]
    q3 = epoch_timestamps[q3_index]
    iqr = q3 - q1

    # A multiplier of 2.5 is a bit more aggressive than the standard 1.5
    # which is good for time-series data with potential large gaps.
    lower_bound = q1 - 2.5 * iqr
    upper_bound = q3 + 2.5 * iqr

    filtered_timestamps = [ts for ts in epoch_timestamps if lower_bound <= ts <= upper_bound]

    if not filtered_timestamps or len(filtered_timestamps) < 2:
        # Fallback to simple duration if all timestamps are filtered out
        return epoch_timestamps[-1] - epoch_timestamps[0]

    return filtered_timestamps[-1] - filtered_timestamps[0]


# Database Models
class Pilot(Base):
    __tablename__ = "pilots"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    is_default = Column(Boolean, default=False)

    flights = relationship("Flight", back_populates="pilot")

class Drone(Base):
    __tablename__ = "drones"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    notes = Column(String, nullable=True)

    flights = relationship("Flight", back_populates="drone")
    images = relationship("DroneImage", back_populates="drone", cascade="all, delete-orphan")

class FlightLocation(Base):
    __tablename__ = "flight_locations"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    latitude = Column(Float)
    longitude = Column(Float)
    notes = Column(String, nullable=True)
    is_valid = Column(Boolean, default=True)
    invalidation_notes = Column(String, nullable=True)
    altitude_offset = Column(Float, default=0.0)

    flights = relationship("Flight", back_populates="flight_location")
    images = relationship("LocationImage", back_populates="location", cascade="all, delete-orphan")

class Flight(Base):
    __tablename__ = "flights"
    id = Column(Integer, primary_key=True, index=True)
    pilot_id = Column(Integer, ForeignKey("pilots.id"))
    drone_id = Column(Integer, ForeignKey("drones.id"))
    flight_location_id = Column(Integer, ForeignKey("flight_locations.id"), nullable=True)
    flight_date = Column(Date)
    csv_log_path = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    is_valid = Column(Boolean, default=True)
    invalidation_notes = Column(String, nullable=True)

    pilot = relationship("Pilot", back_populates="flights")
    drone = relationship("Drone", back_populates="flights")
    flight_location = relationship("FlightLocation", back_populates="flights")
    flight_data = relationship("FlightData", back_populates="flight", cascade="all, delete-orphan")
    battery_packs = relationship("BatteryPack",
                                 secondary=flight_battery_packs,
                                 back_populates="flights")

class FlightData(Base):
    __tablename__ = "flight_data"
    id = Column(Integer, primary_key=True, index=True)
    flight_id = Column(Integer, ForeignKey("flights.id"))
    timestamp = Column(DateTime)
    latitude = Column(Float)
    longitude = Column(Float)
    altitude = Column(Float)
    speed = Column(Float, nullable=True)
    rx_bt = Column(Float, nullable=True) # Receiver Battery Voltage
    rssi = Column(Integer, nullable=True) # RSSI (1RSS(dB))
    rqly = Column(Integer, nullable=True) # Link Quality (RQly(%))
    distance_from_start = Column(Float, nullable=True) # Distance from flight start in meters

    flight = relationship("Flight", back_populates="flight_data")

class BatteryPack(Base):
    __tablename__ = "battery_packs"
    id = Column(Integer, primary_key=True, index=True)
    number = Column(String)
    name = Column(String)
    purchase_date = Column(Date, nullable=True)
    notes = Column(String, nullable=True)
    cycles = Column(Integer, default=0)
    voltage_level = Column(String, nullable=True)
    capacity_mah = Column(Integer, nullable=True)

    flights = relationship("Flight",
                           secondary=flight_battery_packs,
                           back_populates="battery_packs")

class AppSetting(Base):
    __tablename__ = "app_settings"
    key = Column(String, primary_key=True, index=True)
    value = Column(String)

class LocationImage(Base):
    __tablename__ = "location_images"
    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("flight_locations.id"))
    file_path = Column(String, unique=True, index=True) # Path to the stored image file
    description = Column(String, nullable=True)
    upload_date = Column(DateTime, default=datetime.utcnow)

    location = relationship("FlightLocation", back_populates="images")

class DroneImage(Base):
    __tablename__ = "drone_images"
    id = Column(Integer, primary_key=True, index=True)
    drone_id = Column(Integer, ForeignKey("drones.id"))
    file_path = Column(String, unique=True, index=True) # Path to the stored image file
    description = Column(String, nullable=True)
    upload_date = Column(DateTime, default=datetime.utcnow)

    drone = relationship("Drone", back_populates="images")


# Create database tables
Base.metadata.create_all(bind=engine)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

app = FastAPI()

# Custom JSON encoder for datetime objects
class CustomJsonEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        return json.JSONEncoder.default(self, obj)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Allow your frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler for RequestValidationError
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"GLOBAL Pydantic Validation Error: {exc.errors()}")
    return JSONResponse(
        status_code=HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "body": exc.body},
    )

# Pydantic Models for Request/Response
class PilotBase(BaseModel):
    name: str

class PilotCreate(PilotBase):
    pass

class PilotUpdate(PilotBase):
    is_default: Optional[bool] = None

class PilotResponse(PilotBase):
    id: int
    is_default: bool

    class Config:
        from_attributes = True

class DroneBase(BaseModel):
    name: str
    notes: Optional[str] = None

class DroneCreate(DroneBase):
    pass

class DroneUpdate(DroneBase):
    pass

class DroneResponse(DroneBase):
    id: int

    class Config:
        from_attributes = True

class FlightLocationBase(BaseModel):
    name: str
    latitude: float
    longitude: float
    notes: Optional[str] = None
    altitude_offset: Optional[float] = None

class FlightLocationCreate(FlightLocationBase):
    pass

class FlightLocationUpdate(FlightLocationBase):
    pass

class FlightLocationResponse(FlightLocationBase):
    id: int
    is_valid: bool
    invalidation_notes: Optional[str] = None

    class Config:
        from_attributes = True

class FlightLocationWithStatsResponse(FlightLocationResponse):
    flight_count: int

class LocationImageBase(BaseModel):
    location_id: int
    description: Optional[str] = None

class LocationImageResponse(LocationImageBase):
    id: int
    file_path: str
    upload_date: datetime

    class Config:
        from_attributes = True

class DroneImageBase(BaseModel):
    drone_id: int
    description: Optional[str] = None

class DroneImageResponse(DroneImageBase):
    id: int
    file_path: str
    upload_date: datetime

    class Config:
        from_attributes = True


class FlightLocationUpdateStatus(BaseModel):
    is_valid: bool
    invalidation_notes: Optional[str] = None

class FlightLocationAltitudeOffsetUpdate(BaseModel):
    altitude_offset: float

class FlightDataBase(BaseModel):
    timestamp: datetime
    latitude: Optional[float]
    longitude: Optional[float]
    altitude: Optional[float]
    speed: Optional[float] = None
    rx_bt: Optional[float] = None
    rssi: Optional[int] = None
    rqly: Optional[int] = None
    distance_from_start: Optional[float] = None

class FlightDataResponse(FlightDataBase):
    id: int

    class Config:
        from_attributes = True


class FlightBase(BaseModel):
    pilot_id: int
    drone_id: int
    flight_date: datetime
    notes: Optional[str] = None


class BatteryPackBase(BaseModel):
    number: str
    name: str
    purchase_date: Optional[datetime] = None
    notes: Optional[str] = None
    cycles: Optional[int] = 0
    voltage_level: Optional[str] = None
    capacity_mah: Optional[int] = None

class BatteryPackCreate(BatteryPackBase):
    pass

class BatteryPackUpdate(BatteryPackBase):
    pass


class FlightCreate(FlightBase):
    flight_data: Optional[List[FlightDataBase]] = None # For manual flight creation
    battery_pack_ids: Optional[List[int]] = []


class FlightResponseSimple(FlightBase):
    id: int
    csv_log_path: Optional[str] = None
    flight_data: List[FlightDataResponse] = []
    flight_location: Optional[FlightLocationResponse] = None
    is_valid: bool
    invalidation_notes: Optional[str] = None

    class Config:
        from_attributes = True

class BatteryPackResponseSimple(BatteryPackBase):
    id: int
    voltage_level: Optional[str] = None
    capacity_mah: Optional[int] = None

    class Config:
        from_attributes = True


class FlightResponse(FlightBase):
    id: int
    csv_log_path: Optional[str] = None
    flight_data: List[FlightDataResponse] = []
    flight_location: Optional[FlightLocationResponse] = None
    battery_packs: List[BatteryPackResponseSimple] = []
    pilot: PilotResponse # Add pilot object
    drone: DroneResponse # Add drone object
    is_valid: bool
    invalidation_notes: Optional[str] = None
    duration: Optional[float] = None

    class Config:
        from_attributes = True

class FlightUpdateStatus(BaseModel):
    is_valid: bool
    invalidation_notes: Optional[str] = None

class PaginatedFlightsResponse(BaseModel):
    total_flights: int
    flights: List[FlightResponse]



class BatteryPackResponse(BatteryPackBase):
    id: int
    flights: List[FlightResponseSimple] = []

    class Config:
        from_attributes = True

class AppSettingBase(BaseModel):
    key: str
    value: str

class AppSettingResponse(AppSettingBase):
    class Config:
        from_attributes = True

class FlightPerDroneStats(BaseModel):
    drone_id: int
    drone_name: str
    count: int

class LocationStatisticsResponse(BaseModel):
    total_flights: int
    total_flight_duration_seconds: float
    total_distance_meters: float
    flights_per_drone: List[FlightPerDroneStats]
    first_flight_date: Optional[datetime]
    last_flight_date: Optional[datetime]

class BatteryPackUsage(BaseModel):
    battery_pack: BatteryPackResponse
    flight_count: int
    total_duration_seconds: float

class DashboardStatistics(BaseModel):
    total_flights: int
    total_pilots: int
    total_drones: int
    total_flight_duration_seconds: float

@app.get("/statistics/", response_model=DashboardStatistics)
def get_dashboard_statistics(db: Session = Depends(get_db)):
    total_flights = db.query(Flight).filter(Flight.is_valid == True).count()
    total_pilots = db.query(Pilot).count()
    total_drones = db.query(Drone).count()

    total_duration_seconds = 0
    flights = db.query(Flight).options(joinedload(Flight.flight_data)).all()
    for flight in flights:
        total_duration_seconds += calculate_robust_duration(flight.flight_data)

    return DashboardStatistics(
        total_flights=total_flights,
        total_pilots=total_pilots,
        total_drones=total_drones,
        total_flight_duration_seconds=total_duration_seconds
    )

# API Endpoints for Pilots
@app.post("/pilots/", response_model=PilotResponse)
def create_pilot(pilot: PilotCreate, db: Session = Depends(get_db)):
    db_pilot = Pilot(name=pilot.name)
    db.add(db_pilot)
    db.commit()
    db.refresh(db_pilot)
    return db_pilot

@app.get("/pilots/", response_model=List[PilotResponse])
def read_pilots(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    pilots = db.query(Pilot).offset(skip).limit(limit).all()
    return pilots

@app.get("/pilots/{pilot_id}", response_model=PilotResponse)
def read_pilot(pilot_id: int, db: Session = Depends(get_db)):
    pilot = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if pilot is None:
        raise HTTPException(status_code=404, detail="Pilot not found")
    return pilot

@app.put("/pilots/{pilot_id}", response_model=PilotResponse)
def update_pilot(pilot_id: int, pilot: PilotUpdate, db: Session = Depends(get_db)):
    db_pilot = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if db_pilot is None:
        raise HTTPException(status_code=404, detail="Pilot not found")
    
    db_pilot.name = pilot.name
    if pilot.is_default is not None:
        if pilot.is_default:
            # Unset current default pilot
            current_default = db.query(Pilot).filter(Pilot.is_default == True).first()
            if current_default:
                current_default.is_default = False
        db_pilot.is_default = pilot.is_default
    
    db.commit()
    db.refresh(db_pilot)
    return db_pilot

@app.put("/pilots/{pilot_id}/set_default", response_model=PilotResponse)
def set_default_pilot(pilot_id: int, db: Session = Depends(get_db)):
    db_pilot = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if db_pilot is None:
        raise HTTPException(status_code=404, detail="Pilot not found")
    
    # Unset current default pilot
    current_default = db.query(Pilot).filter(Pilot.is_default == True).first()
    if current_default:
        current_default.is_default = False
        db.add(current_default) # Mark as changed
    
    db_pilot.is_default = True
    db.commit()
    db.refresh(db_pilot)
    return db_pilot

@app.delete("/pilots/{pilot_id}")
def delete_pilot(pilot_id: int, db: Session = Depends(get_db)):
    db_pilot = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if db_pilot is None:
        raise HTTPException(status_code=404, detail="Pilot not found")
    db.delete(db_pilot)
    db.commit()
    return {"message": "Pilot deleted successfully"}

@app.post("/drones/", response_model=DroneResponse)
def create_drone(drone: DroneCreate, db: Session = Depends(get_db)):
    db_drone = Drone(name=drone.name, notes=drone.notes)
    db.add(db_drone)
    db.commit()
    db.refresh(db_drone)
    return db_drone

@app.get("/drones/", response_model=List[DroneResponse])
def read_drones(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    drones = db.query(Drone).offset(skip).limit(limit).all()
    return drones

@app.get("/drones/{drone_id}", response_model=DroneResponse)
def read_drone(drone_id: int, db: Session = Depends(get_db)):
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if drone is None:
        raise HTTPException(status_code=404, detail="Drone not found")
    return drone

@app.put("/drones/{drone_id}", response_model=DroneResponse)
def update_drone(drone_id: int, drone: DroneUpdate, db: Session = Depends(get_db)):
    db_drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if db_drone is None:
        raise HTTPException(status_code=404, detail="Drone not found")
    
    db_drone.name = drone.name
    db_drone.notes = drone.notes
    
    db.commit()
    db.refresh(db_drone)
    return db_drone

@app.delete("/drones/{drone_id}")
def delete_drone(drone_id: int, db: Session = Depends(get_db)):
    db_drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if db_drone is None:
        raise HTTPException(status_code=404, detail="Drone not found")
    db.delete(db_drone)
    db.commit()
    return {"message": "Drone deleted successfully"}

# Image upload directory for drones
DRONE_UPLOAD_DIR = "uploads/drones"
os.makedirs(DRONE_UPLOAD_DIR, exist_ok=True)

@app.post("/drones/{drone_id}/images", response_model=DroneImageResponse)
async def upload_drone_image(
    drone_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")

    # Generate a unique filename
    file_extension = file.filename.split(".")[-1]
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    file_path = os.path.join(DRONE_UPLOAD_DIR, unique_filename)

    # Save the file
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())

    # Create database entry
    db_image = DroneImage(
        drone_id=drone_id,
        file_path=file_path,
        description=description
    )
    db.add(db_image)
    db.commit()
    db.refresh(db_image)

    return db_image

@app.get("/drones/{drone_id}/images", response_model=List[DroneImageResponse])
def get_drone_images(drone_id: int, db: Session = Depends(get_db)):
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")
    
    return drone.images

@app.get("/settings/{key}", response_model=AppSettingResponse)
def get_setting(key: str, db: Session = Depends(get_db)):
    setting = db.query(AppSetting).filter(AppSetting.key == key).first()
    if setting is None:
        # Return a default value if not found
        if key == "show_dipul_map_link":
            return AppSettingResponse(key=key, value="true")
        raise HTTPException(status_code=404, detail="Setting not found")
    return setting

@app.post("/settings", response_model=AppSettingResponse)
def create_or_update_setting(setting: AppSettingBase, db: Session = Depends(get_db)):
    db_setting = db.query(AppSetting).filter(AppSetting.key == setting.key).first()
    if db_setting:
        db_setting.value = setting.value
    else:
        db_setting = AppSetting(key=setting.key, value=setting.value)
        db.add(db_setting)
    db.commit()
    db.refresh(db_setting)
    return db_setting

@app.get("/drones/{drone_id}/battery_pack_usage", response_model=List[BatteryPackUsage])
def get_battery_pack_usage(drone_id: int, db: Session = Depends(get_db)):
    drone = db.query(Drone).filter(Drone.id == drone_id).first()
    if not drone:
        raise HTTPException(status_code=404, detail="Drone not found")

    flights = db.query(Flight).filter(Flight.drone_id == drone_id, Flight.is_valid == True).options(joinedload(Flight.battery_packs), joinedload(Flight.flight_data)).all()

    usage_data = {}

    for flight in flights:
        duration_seconds = calculate_robust_duration(flight.flight_data)

        for pack in flight.battery_packs:
            if pack.id not in usage_data:
                usage_data[pack.id] = {
                    "battery_pack": pack,
                    "flight_count": 0,
                    "total_duration_seconds": 0
                }
            usage_data[pack.id]["flight_count"] += 1
            usage_data[pack.id]["total_duration_seconds"] += duration_seconds

    return [BatteryPackUsage(**data) for data in usage_data.values()]

# Helper for JSON deserialization of datetime
def datetime_parser(dct):
    for k, v in dct.items():
        if isinstance(v, str):
            try:
                # Try parsing as datetime first
                if 'T' in v: # ISO format for datetime
                    dct[k] = datetime.fromisoformat(v)
                else: # Try parsing as date
                    dct[k] = date.fromisoformat(v)
            except ValueError:
                pass
    return dct

# API Endpoints for BatteryPacks
@app.post("/battery_packs/", response_model=BatteryPackResponse)
def create_battery_pack(battery_pack: BatteryPackCreate, db: Session = Depends(get_db)):
    db_battery_pack = BatteryPack(**battery_pack.model_dump())
    db.add(db_battery_pack)
    db.commit()
    db.refresh(db_battery_pack)
    return db_battery_pack

@app.get("/battery_packs/", response_model=List[BatteryPackResponse])
def read_battery_packs(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    battery_packs = db.query(BatteryPack).offset(skip).limit(limit).all()
    return battery_packs

@app.get("/battery_packs/{battery_pack_id}", response_model=BatteryPackResponse)
def read_battery_pack(battery_pack_id: int, db: Session = Depends(get_db)):
    battery_pack = db.query(BatteryPack).options(joinedload(BatteryPack.flights)).filter(BatteryPack.id == battery_pack_id).first()
    if battery_pack is None:
        raise HTTPException(status_code=404, detail="BatteryPack not found")
    return battery_pack

@app.put("/battery_packs/{battery_pack_id}", response_model=BatteryPackResponse)
def update_battery_pack(battery_pack_id: int, battery_pack: BatteryPackUpdate, db: Session = Depends(get_db)):
    db_battery_pack = db.query(BatteryPack).filter(BatteryPack.id == battery_pack_id).first()
    if db_battery_pack is None:
        raise HTTPException(status_code=404, detail="BatteryPack not found")
    
    for key, value in battery_pack.model_dump().items():
        setattr(db_battery_pack, key, value)
    
    db.commit()
    db.refresh(db_battery_pack)
    return db_battery_pack

@app.delete("/battery_packs/{battery_pack_id}")
def delete_battery_pack(battery_pack_id: int, db: Session = Depends(get_db)):
    db_battery_pack = db.query(BatteryPack).filter(BatteryPack.id == battery_pack_id).first()
    if db_battery_pack is None:
        raise HTTPException(status_code=404, detail="BatteryPack not found")
    db.delete(db_battery_pack)
    db.commit()
    return {"message": "BatteryPack deleted successfully"}


@app.post("/flight_locations/", response_model=FlightLocationResponse)
def create_flight_location(location: FlightLocationCreate, db: Session = Depends(get_db)):
    db_location = FlightLocation(name=location.name, latitude=location.latitude, longitude=location.longitude, notes=location.notes, is_valid=True)
    db.add(db_location)
    db.commit()
    db.refresh(db_location)
    return db_location

@app.get("/flight_locations/", response_model=List[FlightLocationWithStatsResponse])
def read_flight_locations(skip: int = 0, limit: int = 100, include_invalid: bool = False, db: Session = Depends(get_db)):
    query = (
        db.query(
            FlightLocation,
            func.count(Flight.id).label("flight_count")
        )
        .outerjoin(Flight, (Flight.flight_location_id == FlightLocation.id) & (Flight.is_valid == True))
    )

    if not include_invalid:
        query = query.filter(FlightLocation.is_valid == True)

    locations_with_counts = query.group_by(FlightLocation.id).offset(skip).limit(limit).all()

    response_data = []
    for location, count in locations_with_counts:
        response_data.append(
            FlightLocationWithStatsResponse(
                id=location.id,
                name=location.name,
                latitude=location.latitude,
                longitude=location.longitude,
                notes=location.notes,
                is_valid=location.is_valid,
                invalidation_notes=location.invalidation_notes,
                altitude_offset=location.altitude_offset,
                flight_count=count
            )
        )
    return response_data

@app.get("/flight_locations/{location_id}", response_model=FlightLocationResponse)
def read_flight_location(location_id: int, db: Session = Depends(get_db)):
    location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if location is None:
        raise HTTPException(status_code=404, detail="Flight Location not found")
    return location

@app.put("/flight_locations/{location_id}", response_model=FlightLocationResponse)
def update_flight_location(location_id: int, location: FlightLocationUpdate, db: Session = Depends(get_db)):
    db_location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if db_location is None:
        raise HTTPException(status_code=404, detail="Flight Location not found")
    
    db_location.name = location.name
    db_location.latitude = location.latitude
    db_location.longitude = location.longitude
    db_location.notes = location.notes
    if location.altitude_offset is not None:
        db_location.altitude_offset = location.altitude_offset
    
    db.commit()
    db.refresh(db_location)
    return db_location

@app.put("/flight_locations/{location_id}/altitude_offset", response_model=FlightLocationResponse)
def update_flight_location_altitude_offset(location_id: int, offset_update: FlightLocationAltitudeOffsetUpdate, db: Session = Depends(get_db)):
    db_location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if db_location is None:
        raise HTTPException(status_code=404, detail="Flight Location not found")
    
    db_location.altitude_offset = offset_update.altitude_offset
    
    db.commit()
    db.refresh(db_location)
    return db_location

@app.delete("/flight_locations/{location_id}")
def delete_flight_location(location_id: int, db: Session = Depends(get_db)):
    db_location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if db_location is None:
        raise HTTPException(status_code=404, detail="Flight Location not found")
    
    # Check if any flights are associated with this location
    associated_flights = db.query(Flight).filter(
        Flight.flight_location_id == location_id,
        Flight.is_valid == True  # Only count valid flights
    ).count()
    if associated_flights > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete location {location_id} as it is associated with {associated_flights} flights. Please reassign or delete associated flights first.")

    db.delete(db_location)
    db.commit()
    return {"message": "Flight Location deleted successfully"}

# Image upload directory
UPLOAD_DIR = "uploads/locations"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/locations/{location_id}/images", response_model=LocationImageResponse)
async def upload_location_image(
    location_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Flight Location not found")

    # Generate a unique filename
    file_extension = file.filename.split(".")[-1]
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    # Save the file
    with open(file_path, "wb") as buffer:
        buffer.write(await file.read())

    # Create database entry
    db_image = LocationImage(
        location_id=location_id,
        file_path=file_path,
        description=description
    )
    db.add(db_image)
    db.commit()
    db.refresh(db_image)

    return db_image

@app.get("/locations/{location_id}/images", response_model=List[LocationImageResponse])
def get_location_images(location_id: int, db: Session = Depends(get_db)):
    location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Flight Location not found")
    
    return location.images

@app.get("/images/{image_type}/{image_id}")
def serve_image(image_type: str, image_id: int, db: Session = Depends(get_db)):
    image = None
    if image_type == 'location':
        image = db.query(LocationImage).filter(LocationImage.id == image_id).first()
    elif image_type == 'drone':
        image = db.query(DroneImage).filter(DroneImage.id == image_id).first()
    else:
        raise HTTPException(status_code=400, detail="Invalid image type")

    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    print(f"DEBUG: Attempting to serve image from path: {image.file_path}")
    # Ensure the file exists on disk
    if not os.path.exists(image.file_path):
        raise HTTPException(status_code=404, detail="Image file not found on server")
    
    return FileResponse(image.file_path)

@app.delete("/images/{image_type}/{image_id}")
def delete_image(image_type: str, image_id: int, db: Session = Depends(get_db)):
    image = None
    if image_type == 'location':
        image = db.query(LocationImage).filter(LocationImage.id == image_id).first()
    elif image_type == 'drone':
        image = db.query(DroneImage).filter(DroneImage.id == image_id).first()
    else:
        raise HTTPException(status_code=400, detail="Invalid image type")

    if image:
        # Delete file from disk
        if os.path.exists(image.file_path):
            os.remove(image.file_path)
        # Delete database entry
        db.delete(image)
        db.commit()
        return {"message": "Image deleted successfully"}
    
    raise HTTPException(status_code=404, detail="Image not found")

@app.put("/flight_locations/{location_id}/set_validity", response_model=FlightLocationResponse)
def set_flight_location_validity(location_id: int, status: FlightLocationUpdateStatus, db: Session = Depends(get_db)):
    db_location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if db_location is None:
        raise HTTPException(status_code=404, detail="Flight Location not found")
    
    db_location.is_valid = status.is_valid
    db_location.invalidation_notes = status.invalidation_notes
    
    db.commit()
    db.refresh(db_location)
    return db_location

@app.get("/export_db", response_class=Response, responses={200: {"content": {"application/json": {}}}})
def export_database(db: Session = Depends(get_db)):
    data = {}
    data['pilots'] = [PilotResponse.model_validate(p).model_dump(mode='json') for p in db.query(Pilot).all()]
    data['drones'] = [DroneResponse.model_validate(d).model_dump(mode='json') for d in db.query(Drone).all()]
    data['flight_locations'] = [FlightLocationResponse.model_validate(fl).model_dump(mode='json') for fl in db.query(FlightLocation).all()]
    data['battery_packs'] = [BatteryPackResponse.model_validate(bp).model_dump(mode='json') for bp in db.query(BatteryPack).all()]
    data['drone_images'] = [DroneImageResponse.model_validate(di).model_dump(mode='json') for di in db.query(DroneImage).all()]
    data['location_images'] = [LocationImageResponse.model_validate(li).model_dump(mode='json') for li in db.query(LocationImage).all()]

    flights_data = []
    for flight in db.query(Flight).options(joinedload(Flight.flight_data), joinedload(Flight.battery_packs)).all():
        # Use FlightResponse to serialize the flight object
        flight_response = FlightResponse.model_validate(flight)
        flight_dict = flight_response.model_dump(mode='json') # Explicitly set mode='json'

        # Manually add battery_pack_ids as FlightResponse doesn't have it directly
        flight_dict['battery_pack_ids'] = [bp.id for bp in flight.battery_packs]
        flight_dict['is_valid'] = flight.is_valid
        flight_dict['invalidation_notes'] = flight.invalidation_notes

        flights_data.append(flight_dict)
    data['flights'] = flights_data

    return Response(content=json.dumps(data, indent=4), media_type="application/json")

@app.post("/import_db")
async def import_database(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        content = await file.read()
        print(f"DEBUG: Received content length: {len(content)}")
        data = json.loads(content, object_hook=datetime_parser)
        # print(f"DEBUG: Parsed JSON data: {data}") # Print the parsed data

        # Temporarily disable foreign key checks
        db.execute(text("SET session_replication_role = 'replica';"))
        db.commit()
        print("DEBUG: Foreign key checks disabled.")

        # Clear existing data in a specific order to avoid foreign key issues
        db.execute(text("DELETE FROM flight_battery_packs"))
        db.query(FlightData).delete()
        db.query(Flight).delete()
        db.query(BatteryPack).delete()
        db.query(DroneImage).delete()
        db.query(LocationImage).delete()
        db.query(Drone).delete()
        db.query(Pilot).delete()
        db.query(FlightLocation).delete()
        db.commit()
        print("DEBUG: Existing data cleared.")

        # Re-enable foreign key checks
        db.execute(text("SET session_replication_role = 'origin';"))
        db.commit()
        print("DEBUG: Foreign key checks re-enabled.")

        # Import data in dependency order
        for pilot_data in data.get('pilots', []):
            db_pilot = Pilot(**{k: v for k, v in pilot_data.items() if k != 'flights'})
            db.add(db_pilot)
            db.flush() # To get the ID for relationships
        db.commit()

        for drone_data in data.get('drones', []):
            db_drone = Drone(**{k: v for k, v in drone_data.items() if k != 'flights'})
            db.add(db_drone)
            db.flush()
        db.commit()

        for location_data in data.get('flight_locations', []):
            is_valid = location_data.pop('is_valid', True)
            invalidation_notes = location_data.pop('invalidation_notes', None)
            db_location = FlightLocation(**{k: v for k, v in location_data.items() if k != 'flights'}, is_valid=is_valid, invalidation_notes=invalidation_notes)
            db.add(db_location)
            db.flush()
        db.commit()

        for battery_pack_data in data.get('battery_packs', []):
            db_battery_pack = BatteryPack(**{k: v for k, v in battery_pack_data.items() if k != 'flights'})
            db.add(db_battery_pack)
            db.flush()
        db.commit()

        # Import Drone Images
        for drone_image_data in data.get('drone_images', []):
            db_drone_image = DroneImage(**drone_image_data)
            db.add(db_drone_image)
            db.flush()
        db.commit()

        # Import Location Images
        for location_image_data in data.get('location_images', []):
            db_location_image = LocationImage(**location_image_data)
            db.add(db_location_image)
            db.flush()
        db.commit()

        # Flights and FlightData (most complex due to relationships and nested data)
        for flight_data_item in data.get('flights', []):
            # Extract related IDs and nested data before creating the flight object
            battery_pack_ids = flight_data_item.pop('battery_pack_ids', [])
            flight_data_points = flight_data_item.pop('flight_data', []) # Pop flight_data points

            # Pop the IDs from the dictionary before unpacking
            flight_id = flight_data_item.pop('id') # Need to pop id as well
            pilot_id = flight_data_item.pop('pilot_id')
            drone_id = flight_data_item.pop('drone_id')
            
            # Extract the flight_location dictionary, then get its ID
            flight_location_data = flight_data_item.pop('flight_location', None)
            flight_location_id = None
            if flight_location_data and 'id' in flight_location_data:
                flight_location_id = flight_location_data['id']

            flight_date = flight_data_item.pop('flight_date') # Assuming it's always there
            notes = flight_data_item.pop('notes', None)
            csv_log_path = flight_data_item.pop('csv_log_path', None)
            is_valid = flight_data_item.pop('is_valid', True)
            invalidation_notes = flight_data_item.pop('invalidation_notes', None)

            # Fetch related objects
            pilot = db.query(Pilot).filter(Pilot.id == pilot_id).first()
            drone = db.query(Drone).filter(Drone.id == drone_id).first()
            flight_location = None
            if flight_location_id:
                flight_location = db.query(FlightLocation).filter(FlightLocation.id == flight_location_id).first()

            db_flight = Flight(
                id=flight_id, # Explicitly pass ID
                pilot=pilot,
                drone=drone,
                flight_location=flight_location,
                flight_date=date.fromisoformat(flight_date) if isinstance(flight_date, str) else flight_date, # Ensure date object
                notes=notes,
                csv_log_path=csv_log_path,
                is_valid=is_valid,
                invalidation_notes=invalidation_notes
            )
            db.add(db_flight)
            db.flush() # Get flight ID

            # Add flight_data
            for fd_data in flight_data_points:
                # Ensure timestamp is datetime object
                fd_data['timestamp'] = datetime.fromisoformat(fd_data['timestamp']) if isinstance(fd_data['timestamp'], str) else fd_data['timestamp']
                db_flight_data = FlightData(flight_id=db_flight.id, **fd_data)
                db.add(db_flight_data)
            
            # Add battery_packs
            for bp_id in battery_pack_ids:
                battery_pack = db.query(BatteryPack).filter(BatteryPack.id == bp_id).first()
                if battery_pack:
                    db_flight.battery_packs.append(battery_pack)
                    # No need to increment cycles here, as it's already in the imported data

        db.commit()

        # Reset sequences for all tables to avoid conflicts after manual ID insertion
        dialect = db.bind.dialect.name
        if dialect == 'postgresql':
            tables = ["pilots", "drones", "flight_locations", "flights", "flight_data", "battery_packs"]
            for table_name in tables:
                # Get the max ID from the table
                max_id_result = db.execute(text(f"SELECT MAX(id) FROM {table_name};")).scalar()
                max_id = max_id_result if max_id_result is not None else 0 # Handle empty table case
                
                # Set the sequence to max_id + 1, so the next generated ID is max_id + 1
                db.execute(text(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), {max_id} + 1, false);"))
            db.commit()
            print("DEBUG: All primary key sequences reset for postgresql.")

        # Update image paths
        print("DEBUG: Updating image paths...")
        for image in db.query(DroneImage).all():
            print(f"DEBUG: DroneImage old path: {image.file_path}")
            image.file_path = os.path.join("uploads/drones", os.path.basename(image.file_path))
            print(f"DEBUG: DroneImage new path: {image.file_path}")
        for image in db.query(LocationImage).all():
            print(f"DEBUG: LocationImage old path: {image.file_path}")
            image.file_path = os.path.join("uploads/locations", os.path.basename(image.file_path))
            print(f"DEBUG: LocationImage new path: {image.file_path}")
        db.commit()
        print("DEBUG: Image paths updated.")

        return {"message": "Database imported successfully"}
    except Exception as e:
        db.rollback()
        print(f"ERROR: Exception during import: {e}") # Print the exception message
        traceback.print_exc() # Print full traceback
        raise HTTPException(status_code=500, detail=f"Error importing database: {e}")

import zipfile
import shutil
import tempfile

@app.get("/admin/export_zip", response_class=FileResponse)
def export_zip_backup(db: Session = Depends(get_db)):
    temp_dir = tempfile.mkdtemp()
    try:
        # 1. Export database to JSON
        db_export_response = export_database(db)
        db_export_content = db_export_response.body
        db_json_path = os.path.join(temp_dir, "database.json")
        with open(db_json_path, "wb") as f:
            f.write(db_export_content)

        # 2. Copy uploads folder
        uploads_path = "uploads"
        if os.path.exists(uploads_path):
            shutil.copytree(uploads_path, os.path.join(temp_dir, "uploads"))

        # 3. Create Zip archive
        zip_path = shutil.make_archive(f"dronelogger_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}", 'zip', temp_dir)

        # 4. Return the zip file
        return FileResponse(zip_path, media_type='application/zip', filename=os.path.basename(zip_path), background=BackgroundTask(lambda: os.remove(zip_path)))

    finally:
        # 5. Clean up temporary directory
        shutil.rmtree(temp_dir)

import gc

@app.post("/admin/import_zip")
async def import_zip_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    temp_dir = tempfile.mkdtemp()
    try:
        # 1. Save and extract the uploaded zip file
        zip_path = os.path.join(temp_dir, file.filename)
        with open(zip_path, "wb") as buffer:
            buffer.write(await file.read())
        
        extract_dir = os.path.join(temp_dir, "extracted")
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)

        # 2. Find database.json and import it
        db_json_path = os.path.join(extract_dir, "database.json")
        if not os.path.exists(db_json_path):
            raise HTTPException(status_code=400, detail="database.json not found in the zip archive")
        
        with open(db_json_path, "rb") as f:
            # We need to wrap the file content in an UploadFile-like object for the existing function
            json_content = f.read()
            json_upload_file = UploadFile(filename="database.json", file=io.BytesIO(json_content))
            await import_database(file=json_upload_file, db=db)

        # 3. Replace the uploads folder
        print("DEBUG: Replacing uploads folder...")
        
        live_uploads_path = "uploads"
        backup_uploads_path = os.path.join(extract_dir, "uploads")

        # Rename the old uploads directory
        if os.path.exists(live_uploads_path):
            old_uploads_path = f"uploads_old_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            print(f"DEBUG: Renaming old uploads directory to {old_uploads_path}")
            os.rename(live_uploads_path, old_uploads_path)

        # Create a new uploads directory
        os.makedirs(live_uploads_path, exist_ok=True)
        os.makedirs(os.path.join(live_uploads_path, "drones"), exist_ok=True)
        os.makedirs(os.path.join(live_uploads_path, "locations"), exist_ok=True)

        # Copy the new files from the backup
        if os.path.exists(backup_uploads_path):
            for item in os.listdir(backup_uploads_path):
                s = os.path.join(backup_uploads_path, item)
                d = os.path.join(live_uploads_path, item)
                if os.path.isdir(s):
                    print(f"DEBUG: Copying directory from {s} to {d}")
                    shutil.copytree(s, d, dirs_exist_ok=True)
                else:
                    print(f"DEBUG: Copying file from {s} to {d}")
                    shutil.copy2(s, d)
            print("DEBUG: New uploads content copied.")
        else:
            print("DEBUG: No uploads in backup.")

        print("DEBUG: Uploads folder replaced successfully.")
        return {"message": "Backup imported successfully!"}

    except Exception as e:
        # Log the exception for debugging
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"An error occurred during zip import: {e}")
    finally:
        # Clean up
        shutil.rmtree(temp_dir)

@app.get("/flight_locations/{location_id}/statistics", response_model=LocationStatisticsResponse)
def get_location_statistics(location_id: int, db: Session = Depends(get_db)):
    location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Flight Location not found.")

    flights = db.query(Flight).filter(Flight.flight_location_id == location_id, Flight.is_valid == True).options(joinedload(Flight.flight_data)).all()

    total_flights = len(flights)
    total_duration_seconds = 0
    total_distance_meters = 0

    for flight in flights:
        total_duration_seconds += calculate_robust_duration(flight.flight_data)
        if flight.flight_data:
            distances = [dp.distance_from_start for dp in flight.flight_data if dp.distance_from_start is not None]
            max_distance = max(distances) if distances else 0
            if max_distance is not None:
                total_distance_meters += max_distance

    flights_per_drone_query = db.query(Drone.id, Drone.name, func.count(Flight.id)).\
        join(Flight, Flight.drone_id == Drone.id).\
        filter(Flight.flight_location_id == location_id, Flight.is_valid == True).\
        group_by(Drone.id, Drone.name).all()
    
    flights_per_drone = [{'drone_id': id, 'drone_name': name, 'count': count} for id, name, count in flights_per_drone_query]

    first_flight = db.query(func.min(Flight.flight_date)).filter(Flight.flight_location_id == location_id).scalar()
    last_flight = db.query(func.max(Flight.flight_date)).filter(Flight.flight_location_id == location_id).scalar()

    return LocationStatisticsResponse(
        total_flights=total_flights,
        total_flight_duration_seconds=total_duration_seconds,
        total_distance_meters=total_distance_meters,
        flights_per_drone=flights_per_drone,
        first_flight_date=first_flight,
        last_flight_date=last_flight
    )


# API Endpoints for Flights
@app.post("/flights/", response_model=FlightResponse)
def create_flight(flight: FlightCreate, db: Session = Depends(get_db)):
    # For manual flight creation, we need to determine the flight_location_id
    flight_location_id = None
    if flight.flight_data and flight.flight_data[0].latitude is not None and flight.flight_data[0].longitude is not None:
        start_lat = flight.flight_data[0].latitude
        start_lon = flight.flight_data[0].longitude
        
        # Check for existing flight location within 300m radius
        existing_locations = db.query(FlightLocation).all()
        for loc in existing_locations:
            distance = haversine_distance(start_lat, start_lon, loc.latitude, loc.longitude)
            if distance <= 300: # 300 meters radius
                flight_location_id = loc.id
                break
        
        if flight_location_id is None:
            # Create a new flight location
            new_location_name = f"Location ({start_lat:.4f}, {start_lon:.4f})"
            new_location = FlightLocation(name=new_location_name, latitude=start_lat, longitude=start_lon)
            db.add(new_location)
            db.commit()
            db.refresh(new_location)
            flight_location_id = new_location.id

    db_flight = Flight(
        pilot_id=flight.pilot_id,
        drone_id=flight.drone_id,
        flight_date=flight.flight_date.date(), # Store only date
        notes=flight.notes,
        flight_location_id=flight_location_id,
        is_valid=True
    )

    if flight.battery_pack_ids:
        for pack_id in flight.battery_pack_ids:
            pack = db.query(BatteryPack).filter(BatteryPack.id == pack_id).first()
            if pack:
                db_flight.battery_packs.append(pack)
                pack.cycles += 1
    db.add(db_flight)
    db.commit()
    db.refresh(db_flight)
    return db_flight

@app.get("/flights/", response_model=PaginatedFlightsResponse)
def read_flights(
    skip: int = 0,
    limit: int = 25,
    location_id: Optional[int] = None,
    drone_id: Optional[int] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    include_invalid: bool = False,
    db: Session = Depends(get_db)
):
    query = db.query(Flight)

    if not include_invalid:
        query = query.filter(Flight.is_valid == True)

    if location_id:
        query = query.filter(Flight.flight_location_id == location_id)
    if drone_id:
        query = query.filter(Flight.drone_id == drone_id)
    if start_date:
        query = query.filter(Flight.flight_date >= start_date)
    if end_date:
        query = query.filter(Flight.flight_date <= end_date)

    total_flights = query.count()

    flights = query.options(
        joinedload(Flight.flight_data),
        joinedload(Flight.flight_location),
        joinedload(Flight.battery_packs),
        joinedload(Flight.pilot),
        joinedload(Flight.drone)
    ).order_by(Flight.flight_date.desc()).offset(skip).limit(limit).all()

    # Calculate duration for each flight
    for flight in flights:
        flight.duration = calculate_robust_duration(flight.flight_data)
    
    return PaginatedFlightsResponse(total_flights=total_flights, flights=flights)

@app.get("/flights/{flight_id}", response_model=FlightResponse)
def read_flight(flight_id: int, db: Session = Depends(get_db)):
    flight = db.query(Flight).options(
        joinedload(Flight.flight_data), 
        joinedload(Flight.flight_location), 
        joinedload(Flight.battery_packs),
        joinedload(Flight.pilot),
        joinedload(Flight.drone)
    ).filter(Flight.id == flight_id).first()
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    flight.duration = calculate_robust_duration(flight.flight_data)

    return flight

@app.put("/flights/{flight_id}", response_model=FlightResponse)
def update_flight(flight_id: int, flight: FlightCreate, db: Session = Depends(get_db)):
    db_flight = db.query(Flight).options(joinedload(Flight.battery_packs)).filter(Flight.id == flight_id).first()
    if db_flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    
    db_flight.pilot_id = flight.pilot_id
    db_flight.drone_id = flight.drone_id
    db_flight.flight_date = flight.flight_date.date()
    db_flight.notes = flight.notes

    # Update battery packs
    if flight.battery_pack_ids is not None:
        current_pack_ids = {pack.id for pack in db_flight.battery_packs}
        packs_to_remove_ids = current_pack_ids - set(flight.battery_pack_ids)
        for pack_id in packs_to_remove_ids:
            pack = db.query(BatteryPack).filter(BatteryPack.id == pack_id).first()
            if pack:
                db_flight.battery_packs.remove(pack)
                pack.cycles -= 1

        packs_to_add_ids = set(flight.battery_pack_ids) - current_pack_ids
        for pack_id in packs_to_add_ids:
            pack = db.query(BatteryPack).filter(BatteryPack.id == pack_id).first()
            if pack:
                db_flight.battery_packs.append(pack)
                pack.cycles += 1
    
    db.commit()
    db.refresh(db_flight)
    return db_flight

@app.put("/flights/{flight_id}/assign_location/{location_id}", response_model=FlightResponse)
def assign_location_to_flight(flight_id: int, location_id: int, db: Session = Depends(get_db)):
    db_flight = db.query(Flight).filter(Flight.id == flight_id).first()
    if db_flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")

    db_location = db.query(FlightLocation).filter(FlightLocation.id == location_id).first()
    if db_location is None:
        raise HTTPException(status_code=404, detail="Flight Location not found")

    db_flight.flight_location_id = location_id
    db.commit()
    db.refresh(db_flight)
    return db_flight

@app.delete("/flights/{flight_id}")
def delete_flight(flight_id: int, db: Session = Depends(get_db)):
    db_flight = db.query(Flight).filter(Flight.id == flight_id).first()
    if db_flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    db.delete(db_flight)
    db.commit()
    return {"message": "Flight deleted successfully"}


@app.get("/flights/{flight_id}/gpx", response_class=Response)
def export_flight_gpx(flight_id: int, db: Session = Depends(get_db)):
    flight = db.query(Flight).options(joinedload(Flight.flight_data)).filter(Flight.id == flight_id).first()
    if not flight:
        raise HTTPException(status_code=404, detail="Flight not found")

    gpx = gpxpy.gpx.GPX()
    gpx_track = gpxpy.gpx.GPXTrack()
    gpx.tracks.append(gpx_track)
    gpx_segment = gpxpy.gpx.GPXTrackSegment()
    gpx_track.segments.append(gpx_segment)

    for data_point in flight.flight_data:
        if data_point.latitude is not None and data_point.longitude is not None:
            gpx_segment.points.append(gpxpy.gpx.GPXTrackPoint(
                latitude=data_point.latitude,
                longitude=data_point.longitude,
                elevation=data_point.altitude,
                time=data_point.timestamp
            ))

    gpx_data = gpx.to_xml()
    return Response(content=gpx_data, media_type="application/gpx+xml", headers={"Content-Disposition": f"attachment; filename=flight_{flight_id}.gpx"})


@app.get("/flights/{flight_id}/kml", response_class=Response)
def export_flight_kml(flight_id: int, db: Session = Depends(get_db)):
    flight = db.query(Flight).options(joinedload(Flight.flight_data)).filter(Flight.id == flight_id).first()
    if not flight:
        raise HTTPException(status_code=404, detail="Flight not found")

    kml = simplekml.Kml()
    linestring = kml.newlinestring(name=f"Flight {flight_id}")
    
    coords = []
    for data_point in flight.flight_data:
        if data_point.latitude is not None and data_point.longitude is not None:
            coords.append((data_point.longitude, data_point.latitude, data_point.altitude))

    linestring.coords = coords
    linestring.altitudemode = simplekml.AltitudeMode.absolute
    linestring.extrude = 1

    kml_data = kml.kml()
    return Response(content=kml_data, media_type="application/vnd.google-earth.kml+xml", headers={"Content-Disposition": f"attachment; filename=flight_{flight_id}.kml"})

@app.put("/flights/{flight_id}/set_validity", response_model=FlightResponse)
def set_flight_validity(flight_id: int, status: FlightUpdateStatus, db: Session = Depends(get_db)):
    db_flight = db.query(Flight).filter(Flight.id == flight_id).first()
    if db_flight is None:
        raise HTTPException(status_code=404, detail="Flight not found")
    
    db_flight.is_valid = status.is_valid
    db_flight.invalidation_notes = status.invalidation_notes
    
    db.commit()
    db.refresh(db_flight)
    return db_flight

# Helper function to process a single CSV file
# Helper function to process a single CSV file
def process_csv_file(file_path: str, pilot_id: int, db: Session, location_cache: dict, drone_cache: dict):
    # Normalize file_path to be consistent (e.g., always absolute from /app/DroneLogImport)
    normalized_file_path = os.path.join("/app/DroneLogImport", os.path.basename(file_path))
    with open(file_path, 'r', encoding='utf-8') as csvfile:
        # Peek at the header
        header = csvfile.readline().strip()
        csvfile.seek(0)  # Reset file pointer

        reader = csv.DictReader(csvfile)
        
        # Decide which processing function to use based on header
        if 'CUSTOM.dateTime' in header:
            return process_dji_log(file_path, pilot_id, db, reader, location_cache, normalized_file_path, drone_cache)
        elif '1RSS(dB)' in header or 'TxBat(V)' in header:
            return process_edgetx_log(file_path, pilot_id, db, reader, location_cache, normalized_file_path, drone_cache)
        else:
            file_name = os.path.basename(file_path)
            print(f"Skipping {file_name}: Unknown CSV format.")
            return {"status": "skipped", "filename": file_name, "reason": "unknown format"}

def process_dji_log(file_path: str, pilot_id: int, db: Session, reader: csv.DictReader, location_cache: dict, normalized_file_path: str, drone_cache: dict):
    file_name = os.path.basename(file_path)
    rows = list(reader)
    if not rows:
        print(f"Skipping {file_name}: CSV file is empty or malformed.")
        return {"status": "skipped", "filename": file_name, "reason": "empty or malformed"}

    # Get pilot object (must exist)
    pilot_obj = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if not pilot_obj:
        print(f"Skipping {file_name}: Pilot with ID {pilot_id} not found.")
        return {"status": "skipped", "filename": file_name, "reason": f"Pilot {pilot_id} not found"}

    # Determine drone from the first valid row of the CSV
    drone_name_from_csv = None
    for row in rows:
        drone_name_from_csv = row.get('RECOVER.aircraftName') or row.get('DETAILS.aircraftName')
        if drone_name_from_csv:
            break
    if not drone_name_from_csv:
        drone_name_from_csv = file_name.split('-')[0].strip()

    if drone_name_from_csv in drone_cache:
        db_drone = drone_cache[drone_name_from_csv]
    else:
        db_drone = db.query(Drone).filter(Drone.name == drone_name_from_csv).first()
        if not db_drone:
            db_drone = Drone(name=drone_name_from_csv)
            db.add(db_drone)
        drone_cache[drone_name_from_csv] = db_drone

    # Extract flight date from the first valid row (ignoring placeholder dates)
    flight_date = None
    for row in rows:
        flight_date_str = row.get('CUSTOM.dateTime')
        if flight_date_str and not flight_date_str.startswith('1970-01-01'):
            try:
                flight_date = datetime.fromisoformat(flight_date_str.replace('Z', '+00:00')).date()
                break
            except ValueError:
                continue
    
    if not flight_date:
        print(f"Skipping {file_name}: No valid 'CUSTOM.dateTime' found in CSV.")
        return {"status": "skipped", "filename": file_name, "reason": "invalid date format"}

    # Check if flight already exists
    file_basename = os.path.basename(normalized_file_path)
    print(f"DEBUG: Checking for existing flight with basename: {file_basename}")

    # Query for flights with the same basename
    potential_existing_flights = db.query(Flight).filter(
        func.substr(Flight.csv_log_path, func.length(Flight.csv_log_path) - func.length(file_basename) + 1) == file_basename
    ).all()

    existing_flight = None
    for flight in potential_existing_flights:
        # Normalize the stored path for comparison
        stored_path_basename = os.path.basename(flight.csv_log_path)
        normalized_stored_path = os.path.join("/app/DroneLogImport", stored_path_basename)
        
        if normalized_stored_path == normalized_file_path:
            existing_flight = flight
            break

    if existing_flight:
        print(f"DEBUG: Found existing flight. Existing flight's csv_log_path: {existing_flight.csv_log_path}")
        print(f"Skipping {file_name}: A flight from this log file has already been imported.")
        return {"status": "skipped", "filename": file_name, "reason": "log file already imported"}
    else:
        print(f"DEBUG: No existing flight found for {normalized_file_path}")

    flight_data_points = []
    start_lat, start_lon = None, None

    for row in rows:
        try:
            timestamp_str = row.get('CUSTOM.dateTime')
            if not timestamp_str or timestamp_str.startswith('1970-01-01'):
                continue
            
            timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            latitude = float(row['OSD.latitude']) if row.get('OSD.latitude') and row['OSD.latitude'] != '0.0' else None
            longitude = float(row['OSD.longitude']) if row.get('OSD.longitude') and row['OSD.longitude'] != '0.0' else None
            
            if latitude is not None and longitude is not None:
                if start_lat is None and start_lon is None:
                    start_lat, start_lon = latitude, longitude

                distance_from_start = haversine_distance(start_lat, start_lon, latitude, longitude)
                
                # Speed from xSpeed and ySpeed (m/s to km/h)
                xSpeed = float(row.get('OSD.xSpeed', 0))
                ySpeed = float(row.get('OSD.ySpeed', 0))
                speed_kmh = math.sqrt(xSpeed**2 + ySpeed**2) * 3.6

                data_point = {
                    'timestamp': timestamp,
                    'latitude': latitude,
                    'longitude': longitude,
                    'altitude': float(row['OSD.height']) if row.get('OSD.height') else None,
                    'speed': speed_kmh,
                    'rssi': int(row['RC.downlinkSignal']) if row.get('RC.downlinkSignal') else None,
                    'rqly': int(row['RC.uplinkSignal']) if row.get('RC.uplinkSignal') else None,
                    'distance_from_start': distance_from_start
                }
                flight_data_points.append(data_point)

        except (ValueError, TypeError) as e:
            print(f"Error parsing row in {file_name}: {e} - Row: {row}")
            continue

    if not flight_data_points:
        print(f"Skipping {file_name}: No valid flight data points found.")
        return {"status": "skipped", "filename": file_name, "reason": "no valid data"}

    # Calculate duration
    timestamps = [dp['timestamp'] for dp in flight_data_points if dp.get('timestamp')]
    duration_seconds = (max(timestamps) - min(timestamps)).total_seconds() if timestamps else 0

    if duration_seconds < 30:
        print(f"Skipping {file_name}: Flight duration is {duration_seconds:.2f}s, less than 30 seconds.")
        return {"status": "skipped", "filename": file_name, "reason": "short duration"}

    db_location = None
    if start_lat is not None and start_lon is not None:
        # Check for existing flight location within 300m radius
        found_location = None
        for loc_name, loc_obj in location_cache.items(): # Check cache first
            distance = haversine_distance(start_lat, start_lon, loc_obj.latitude, loc_obj.longitude)
            if distance <= 300: # 300 meters radius
                found_location = loc_obj
                break
        
        if not found_location: # If not found in cache, check DB
            existing_locations_in_db = db.query(FlightLocation).all()
            for loc in existing_locations_in_db:
                distance = haversine_distance(start_lat, start_lon, loc.latitude, loc.longitude)
                if distance <= 300: # 300 meters radius
                    found_location = loc
                    break

        if found_location:
            db_location = found_location
            # Add to cache if found in DB and not already there
            location_cache[found_location.name] = found_location
        else:
            # Create a new flight location
            new_location_name = f"Location ({start_lat:.4f}, {start_lon:.4f})"

            new_location = FlightLocation(name=new_location_name, latitude=start_lat, longitude=start_lon)

            db.add(new_location)

            db.flush() # Flush to get ID for new location
            db_location = new_location
            location_cache[new_location_name] = new_location

    # Calculate distance from start for all data points
    start_lat, start_lon = None, None
    for dp in flight_data_points:
        if dp.get('latitude') is not None and dp.get('longitude') is not None:
            if start_lat is None:
                start_lat, start_lon = dp['latitude'], dp['longitude']
            dp['distance_from_start'] = haversine_distance(start_lat, start_lon, dp['latitude'], dp['longitude'])

    flight_data_objects = [FlightData(**dp) for dp in flight_data_points]

    flight_notes = None
    db_flight = Flight(
        pilot=pilot_obj,
        drone=db_drone,
        flight_date=flight_date,
        csv_log_path=normalized_file_path,
        notes=flight_notes,
        flight_location=db_location,
        is_valid=True,
        flight_data=flight_data_objects
    )
    db.add(db_flight)

    return {"status": "processed", "filename": file_name, "type": "dji"}

def process_edgetx_log(file_path: str, pilot_id: int, db: Session, reader: csv.DictReader, location_cache: dict, normalized_file_path: str, drone_cache: dict):
    file_name = os.path.basename(file_path)
    
    rows = list(reader)
    if not rows:
        print(f"Skipping {file_name}: CSV file is empty or malformed.")
        return {"status": "skipped", "filename": file_name, "reason": "empty or malformed"}

    # Get pilot (must exist)
    pilot_obj = db.query(Pilot).filter(Pilot.id == pilot_id).first()
    if not pilot_obj:
        print(f"Skipping {file_name}: Pilot with ID {pilot_id} not found.")
        return {"status": "skipped", "filename": file_id, "reason": "not found"}

    # Determine drone from filename
    drone_name_from_filename = file_name.split('-')[0].strip()
    db_drone = None
    if drone_name_from_filename:
        if drone_name_from_filename in drone_cache:
            db_drone = drone_cache[drone_name_from_filename]
        else:
            db_drone = db.query(Drone).filter(Drone.name == drone_name_from_filename).first()
            if not db_drone:
                # Create new drone if not found
                db_drone = Drone(name=drone_name_from_filename)
                db.add(db_drone)
            drone_cache[drone_name_from_filename] = db_drone
    else:
        print(f"Skipping {file_name}: Drone name could not be identified from filename.")
        return {"status": "skipped", "filename": file_name, "reason": "drone name not in filename"}

    # Extract main flight details from the first row
    first_row = rows[0]
    flight_date_str = first_row.get('Date', datetime.now().strftime("%Y-%m-%d"))
    flight_notes = None

    try:
        flight_date = datetime.strptime(flight_date_str, "%Y-%m-%d").date()
    except ValueError:
        print(f"Skipping {file_name}: Invalid 'Date' format in CSV. Expected YYYY-MM-DD.")
        return {"status": "skipped", "filename": file_name, "reason": "invalid date format"}

    # Check if flight already exists
    file_basename = os.path.basename(normalized_file_path)
    print(f"DEBUG: Checking for existing flight with basename: {file_basename}")

    # Query for flights with the same basename
    potential_existing_flights = db.query(Flight).filter(
        func.substr(Flight.csv_log_path, func.length(Flight.csv_log_path) - func.length(file_basename) + 1) == file_basename
    ).all()

    existing_flight = None
    for flight in potential_existing_flights:
        # Normalize the stored path for comparison
        stored_path_basename = os.path.basename(flight.csv_log_path)
        normalized_stored_path = os.path.join("/app/DroneLogImport", stored_path_basename)
        
        if normalized_stored_path == normalized_file_path:
            existing_flight = flight
            break

    if existing_flight:
        print(f"DEBUG: Found existing flight. Existing flight's csv_log_path: {existing_flight.csv_log_path}")
        print(f"Skipping {file_name}: A flight from this log file has already been imported.")
        return {"status": "skipped", "filename": file_name, "reason": "log file already imported"}
    else:
        print(f"DEBUG: No existing flight found for {normalized_file_path}")

    flight_data_points = []
    for row in rows:
        try:
            date_str = row.get('Date')
            time_str = row.get('Time')
            if not date_str or not time_str:
                continue
            
            timestamp_str = f"{date_str} {time_str}"
            timestamp = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S.%f")

            gps_str = row.get('GPS')
            latitude = None
            longitude = None
            if gps_str:
                try:
                    lat_str, lon_str = gps_str.split(' ')
                    latitude = float(lat_str)
                    longitude = float(lon_str)
                except (ValueError, IndexError):
                    pass

            flight_data_points.append({
                'timestamp': timestamp,
                'latitude': latitude,
                'longitude': longitude,
                'altitude': float(row['Alt(m)']) if 'Alt(m)' in row and row['Alt(m)'] else None,
                'speed': float(row['GSpd(kmh)']) if 'GSpd(kmh)' in row and row['GSpd(kmh)'] else None,
                'rx_bt': float(row['RxBt(V)']) if 'RxBt(V)' in row and row['RxBt(V)'] else None,
                'rssi': int(row['1RSS(dB)']) if '1RSS(dB)' in row and row['1RSS(dB)'] else None,
                'rqly': int(row['RQly(%)']) if 'RQly(%)' in row and row['RQly(%)'] else None,
            })
        except (ValueError, TypeError) as e:
            print(f"Error parsing row in {file_name}: {e} - Row: {row}")
            continue

    if not flight_data_points:
        print(f"Skipping {file_name}: No valid flight data points found.")
        return {"status": "skipped", "filename": file_name, "reason": "no valid data"}

    timestamps = [dp['timestamp'] for dp in flight_data_points if dp.get('timestamp')]
    duration_seconds = (max(timestamps) - min(timestamps)).total_seconds() if timestamps else 0

    if duration_seconds < 30:
        print(f"Skipping {file_name}: Flight duration is {duration_seconds:.2f}s, less than 30 seconds.")
        return {"status": "skipped", "filename": file_name, "reason": "short duration"}

    db_location = None
    start_lat, start_lon = None, None
    for dp in flight_data_points:
        if dp.get('latitude') is not None and dp.get('longitude') is not None:
            start_lat = dp['latitude']
            start_lon = dp['longitude']
            break

    if start_lat is not None and start_lon is not None:
        # Check for existing flight location within 300m radius
        found_location = None
        for loc_name, loc_obj in location_cache.items(): # Check cache first
            distance = haversine_distance(start_lat, start_lon, loc_obj.latitude, loc_obj.longitude)
            if distance <= 300: # 300 meters radius
                found_location = loc_obj
                break

        if not found_location: # If not found in cache, check DB
            existing_locations_in_db = db.query(FlightLocation).all()
            for loc in existing_locations_in_db:
                distance = haversine_distance(start_lat, start_lon, loc.latitude, loc.longitude)
                if distance <= 300: # 300 meters radius
                    found_location = loc
                    break

        if found_location:
            db_location = found_location
            # Add to cache if found in DB and not already there
            location_cache[found_location.name] = found_location
        else:
            # Create a new flight location
            new_location_name = f"Location ({start_lat:.4f}, {start_lon:.4f})"

            new_location = FlightLocation(name=new_location_name, latitude=start_lat, longitude=start_lon)

            db.add(new_location)

            db.flush() # Flush to get ID for new location
            db_location = new_location
            location_cache[new_location_name] = new_location
    
    start_lat, start_lon = None, None
    for dp in flight_data_points:
        if dp.get('latitude') is not None and dp.get('longitude') is not None:
            if start_lat is None:
                start_lat, start_lon = dp['latitude'], dp['longitude']
            dp['distance_from_start'] = haversine_distance(start_lat, start_lon, dp['latitude'], dp['longitude'])

    flight_data_objects = [FlightData(**dp) for dp in flight_data_points]

    db_flight = Flight(
        pilot=pilot_obj,
        drone=db_drone,
        flight_date=flight_date,
        csv_log_path=normalized_file_path,
        notes=flight_notes,
        flight_location=db_location,
        is_valid=True,
        flight_data=flight_data_objects
    )
    db.add(db_flight)
    
    return {"status": "processed", "filename": file_name}

# Bulk CSV Import Endpoint
@app.post("/flights/import_all_csvs")
async def import_all_csvs(pilot_id: int = Form(...), db: Session = Depends(get_db)):
    import_dir = "/app/DroneLogImport"
    if not os.path.exists(import_dir):
        raise HTTPException(status_code=404, detail=f"Directory '{import_dir}' not found.")

    processed_files = []
    location_cache = {}  # Cache for new locations within this transaction
    drone_cache = {}
    try:
        for csv_file in glob.glob(os.path.join(import_dir, "*.csv")):
            result = process_csv_file(csv_file, pilot_id, db, location_cache, drone_cache)
            processed_files.append(result)
        db.commit()
    except Exception as e:
        db.rollback()
        # It's helpful to log the full error on the server for debugging
        print(f"ERROR during bulk import: {e}")
        traceback.print_exc() # Print full traceback
        raise HTTPException(status_code=500, detail=f"An error occurred during bulk import. Check server logs.")

    return {"message": "Bulk import complete.", "results": processed_files}

# CSV Upload Endpoint (single file)
@app.post("/flights/upload_csv")
async def upload_csv(file: UploadFile = File(...), pilot_id: int = Form(...), drone_id: Optional[int] = Form(None), db: Session = Depends(get_db)):
    # Ensure a directory for CSV logs exists
    csv_logs_dir = "csv_logs"
    os.makedirs(csv_logs_dir, exist_ok=True)

    file_location = os.path.join(csv_logs_dir, file.filename)
    with open(file_location, "wb+") as file_object:
        file_object.write(file.file.read())

    # Use the helper function to process the uploaded file
    result = process_csv_file(file_location, pilot_id, db)
    if result["status"] == "skipped":
        raise HTTPException(status_code=400, detail=f"Failed to process {result['filename']}: {result['reason']}")
    
    return {"message": f"File '{file.filename}' uploaded and processed successfully."}