from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class AccelerationRequest(BaseModel):
    """Request model for acceleration calculation"""
    timestamps: List[datetime] = Field(..., description="Timestamps for the metrics")
    metrics: List[float] = Field(..., description="Throughput metrics (e.g., PRs per day)")
    smoothing_alpha: Optional[float] = Field(0.3, description="Exponential smoothing parameter")

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class AccelerationResponse(BaseModel):
    """Response model for acceleration calculation"""
    current_velocity: float = Field(..., description="Current smoothed velocity")
    current_acceleration: float = Field(..., description="Current acceleration value")
    trend: str = Field(..., description="Trend classification: improving, stable, declining")
    confidence: float = Field(..., description="Confidence score (0-1)")
    velocity_history: List[float] = Field(..., description="Smoothed velocity time series")
    acceleration_history: List[float] = Field(..., description="Acceleration time series")

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    service: str