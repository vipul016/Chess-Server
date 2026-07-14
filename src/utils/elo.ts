export function calculateElo(whiteRating: number, blackRating: number, outcome: 'w' | 'b' | 'd') {
    const K = 32;
    
    const expectedWhite = 1 / (1 + Math.pow(10, (blackRating - whiteRating) / 400));
    const expectedBlack = 1 / (1 + Math.pow(10, (whiteRating - blackRating) / 400));

    let actualWhite = 0;
    let actualBlack = 0;
    
    if (outcome === 'w') {
        actualWhite = 1;
        actualBlack = 0;
    } else if (outcome === 'b') {
        actualWhite = 0;
        actualBlack = 1;
    } else if (outcome === 'd') {
        actualWhite = 0.5;
        actualBlack = 0.5;
    }

    // Calculate new ratings
    const newWhite = Math.round(whiteRating + K * (actualWhite - expectedWhite));
    const newBlack = Math.round(blackRating + K * (actualBlack - expectedBlack));

    return {
        newWhite,
        newBlack,
        whiteDiff: newWhite - whiteRating,
        blackDiff: newBlack - blackRating
    };
}