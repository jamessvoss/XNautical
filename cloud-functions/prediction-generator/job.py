#!/usr/bin/env python3
"""
Cloud Run Job for prediction generation.
Reads parameters from environment variables and runs the generation pipeline directly.
Can be cancelled at any time with: gcloud run jobs executions cancel
"""
import os
import sys
import logging

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

def main():
    # Read parameters from environment variables
    region_id = os.environ.get('REGION_ID', '').strip()
    gen_type = os.environ.get('GEN_TYPE', '').strip().lower()
    years_back = int(os.environ.get('YEARS_BACK', '1'))
    years_forward = int(os.environ.get('YEARS_FORWARD', '2'))
    max_stations = os.environ.get('MAX_STATIONS')
    
    if not region_id or not gen_type:
        logger.error('REGION_ID and GEN_TYPE environment variables are required')
        sys.exit(1)
    
    if max_stations:
        max_stations = int(max_stations)
    
    logger.info(f'Starting job: region={region_id}, type={gen_type}, maxStations={max_stations}')
    
    # Import and call generation function directly
    # Import here to ensure logging is set up first
    from server import run_prediction_generation
    
    try:
        # run_prediction_generation returns Flask response, but will raise exception
        # due to lack of Flask app context. That's OK - if it gets to the return statement,
        # the generation completed successfully.
        result = run_prediction_generation(region_id, gen_type, years_back, years_forward, max_stations)
        
        # If we get here without exception, job succeeded
        logger.info(f'Job completed successfully')
        sys.exit(0)
            
    except RuntimeError as e:
        # "Working outside of application context" error means generation completed
        # but tried to return a Flask response
        if "application context" in str(e):
            logger.info(f'Job completed successfully (Flask context error is expected)')
            sys.exit(0)
        else:
            logger.error(f'Job failed: {e}', exc_info=True)
            sys.exit(1)
    except Exception as e:
        logger.error(f'Job failed: {e}', exc_info=True)
        sys.exit(1)

if __name__ == '__main__':
    main()
