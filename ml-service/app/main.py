from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from .models import AccelerationRequest, AccelerationResponse
from .detector import AccelerationDetector
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Acceleration Detection ML Service",
    description="ML service for detecting team acceleration trends from GitHub metrics",
    version="1.0.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize detector
detector = AccelerationDetector()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "acceleration-ml"}

@app.post("/calculate-acceleration", response_model=AccelerationResponse)
async def calculate_acceleration(request: AccelerationRequest):
    """
    Calculate acceleration metrics from time-series PR data
    """
    try:
        logger.info(f"Processing acceleration request for {len(request.metrics)} data points")

        # Calculate acceleration metrics
        result = detector.calculate_acceleration(
            timestamps=request.timestamps,
            throughput_values=request.metrics,
            smoothing_alpha=request.smoothing_alpha or 0.3
        )

        logger.info(f"Acceleration calculated: {result.current_acceleration:.3f}, trend: {result.trend}")

        return result

    except Exception as e:
        logger.error(f"Error calculating acceleration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)